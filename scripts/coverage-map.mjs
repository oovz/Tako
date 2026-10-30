import path from "node:path"

import istanbulCoverage from "istanbul-lib-coverage"
import istanbulSourceMaps from "istanbul-lib-source-maps"

const { createCoverageMap } = istanbulCoverage
const { createSourceMapStore } = istanbulSourceMaps

function decodeCoverageFileUrl(rawPath) {
  const url = new URL(rawPath)
  let pathname = decodeURIComponent(url.pathname)

  if (/^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1)
  }

  if (url.hostname && url.hostname !== "localhost") {
    return `//${url.hostname}${pathname}`
  }

  return pathname
}

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

function pathFlavor(value) {
  return isWindowsAbsolute(value) ? path.win32 : path.posix
}

function assertNonEmptyPath(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(message)
  }
}

function normalizeCoverageSeparators(decodedPath, flavor) {
  const platformPath =
    flavor === path.win32 && /^[/\\][A-Za-z]:[/\\]/.test(decodedPath)
      ? decodedPath.slice(1)
      : decodedPath
  return flavor === path.win32
    ? platformPath.replaceAll("/", "\\")
    : platformPath.replaceAll("\\", "/")
}

function assertInsideRepository(relativePath, flavor, rawPath) {
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${flavor.sep}`) ||
    flavor.isAbsolute(relativePath)
  ) {
    throw new Error(`Coverage path is outside the repository: ${rawPath}`)
  }
}

export function canonicalizeCoveragePath(rawPath, rootPath) {
  assertNonEmptyPath(rawPath, "Coverage path must be a non-empty string")
  assertNonEmptyPath(rootPath, "Repository root must be a non-empty string")
  const decodedPath = rawPath.startsWith("file:")
    ? decodeCoverageFileUrl(rawPath)
    : rawPath
  const flavor = pathFlavor(rootPath)
  const normalizedRoot = flavor.resolve(rootPath)
  const flavorPath = normalizeCoverageSeparators(decodedPath, flavor)
  const resolvedPath = flavor.isAbsolute(flavorPath)
    ? flavor.resolve(flavorPath)
    : flavor.resolve(normalizedRoot, flavorPath)
  const relativePath = flavor.relative(normalizedRoot, resolvedPath)
  assertInsideRepository(relativePath, flavor, rawPath)
  return relativePath.split(flavor.sep).join("/")
}

function canonicalCoverageIdentity(mapPath, filePath, rootPath) {
  const canonicalMapPath = canonicalizeCoveragePath(mapPath, rootPath)
  const canonicalEmbeddedPath = canonicalizeCoveragePath(filePath, rootPath)
  if (canonicalMapPath !== canonicalEmbeddedPath) {
    throw new Error(
      `Coverage map key and embedded path disagree: ${mapPath} != ${filePath}`
    )
  }
  return canonicalMapPath
}

function isCoveragePosition(position) {
  return (
    Number.isInteger(position?.line) &&
    position.line > 0 &&
    Number.isInteger(position.column) &&
    position.column >= 0
  )
}

function isCoverageLocation(location) {
  const end = location?.end
  const normalizedEnd =
    end?.column === null || end?.column === Infinity
      ? { ...end, column: 0 }
      : end
  return (
    isCoveragePosition(location?.start) && isCoveragePosition(normalizedEnd)
  )
}

function fileCoverageLocations(fileCoverage) {
  return [
    ...Object.values(fileCoverage.statementMap),
    ...Object.values(fileCoverage.fnMap).map((fn) => fn.loc),
    ...Object.values(fileCoverage.branchMap).flatMap(
      (branch) => branch.locations
    ),
  ]
}

export function hasCoverageLocations(coverageMap) {
  return Object.values(coverageMap).some((fileCoverage) =>
    fileCoverageLocations(fileCoverage).some(isCoverageLocation)
  )
}

async function remapCoverageSource(mapPath, fileCoverage, sourceMaps) {
  const rawMap = { [mapPath]: fileCoverage }
  if (!fileCoverage.inputSourceMap) return rawMap
  if (fileCoverage.inputSourceMap.version !== 3) {
    throw new Error(`Unable to remap coverage source: ${mapPath}`)
  }
  const originalMap = await sourceMaps.transformCoverage(
    createCoverageMap(rawMap)
  )
  const originalData = originalMap.toJSON()
  if (hasCoverageLocations(rawMap) && !hasCoverageLocations(originalData)) {
    throw new Error(`Source map lost all coverage locations: ${mapPath}`)
  }
  return originalData
}

function addCanonicalCoverage(canonicalMap, originalData, rootPath) {
  // Persisted reports encode unbounded source-map end columns as null.
  // Use that same representation before Istanbul compares location keys.
  const serialized = JSON.parse(JSON.stringify(originalData))
  for (const [mapPath, fileCoverage] of Object.entries(serialized)) {
    fileCoverage.path = canonicalCoverageIdentity(
      mapPath,
      fileCoverage.path,
      rootPath
    )
    if (Object.hasOwn(fileCoverage, "inputSourceMap")) {
      throw new Error(`Unable to remap coverage source: ${mapPath}`)
    }
    canonicalMap.addFileCoverage(fileCoverage)
  }
}

export async function canonicalizeCoverageMap(rawMap, rootPath) {
  for (const [mapPath, rawFileCoverage] of Object.entries(rawMap ?? {})) {
    canonicalCoverageIdentity(mapPath, rawFileCoverage.path, rootPath)
  }

  const sourceMaps = createSourceMapStore()
  try {
    const canonicalMap = createCoverageMap({})
    for (const [mapPath, fileCoverage] of Object.entries(rawMap ?? {})) {
      const originalData = await remapCoverageSource(
        mapPath,
        fileCoverage,
        sourceMaps
      )
      addCanonicalCoverage(canonicalMap, originalData, rootPath)
    }
    return JSON.parse(JSON.stringify(canonicalMap))
  } finally {
    sourceMaps.dispose()
  }
}

export async function mergeCoverageMaps(rawMaps, rootPath) {
  const merged = createCoverageMap({})

  for await (const rawMap of rawMaps) {
    merged.merge(await canonicalizeCoverageMap(rawMap, rootPath))
  }

  return JSON.parse(JSON.stringify(merged))
}
