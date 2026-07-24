import path from "node:path"

import istanbulCoverage from "istanbul-lib-coverage"

const { createCoverageMap } = istanbulCoverage

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

export function canonicalizeCoveragePath(rawPath, rootPath) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new TypeError("Coverage path must be a non-empty string")
  }
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    throw new TypeError("Repository root must be a non-empty string")
  }

  const decodedPath = rawPath.startsWith("file:")
    ? decodeCoverageFileUrl(rawPath)
    : rawPath
  const flavor = pathFlavor(rootPath)
  const normalizedRoot = flavor.resolve(rootPath)
  const platformPath =
    flavor === path.win32 && /^[/\\][A-Za-z]:[/\\]/.test(decodedPath)
      ? decodedPath.slice(1)
      : decodedPath
  const flavorPath =
    flavor === path.win32
      ? platformPath.replaceAll("/", "\\")
      : platformPath.replaceAll("\\", "/")
  const resolvedPath = flavor.isAbsolute(flavorPath)
    ? flavor.resolve(flavorPath)
    : flavor.resolve(normalizedRoot, flavorPath)
  const relativePath = flavor.relative(normalizedRoot, resolvedPath)

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${flavor.sep}`) ||
    flavor.isAbsolute(relativePath)
  ) {
    throw new Error(`Coverage path is outside the repository: ${rawPath}`)
  }

  return relativePath.split(flavor.sep).join("/")
}

export function canonicalizeCoverageMap(rawMap, rootPath) {
  const canonicalMap = createCoverageMap({})

  for (const [mapPath, rawFileCoverage] of Object.entries(rawMap ?? {})) {
    const canonicalMapPath = canonicalizeCoveragePath(mapPath, rootPath)
    const canonicalEmbeddedPath = canonicalizeCoveragePath(
      rawFileCoverage.path,
      rootPath
    )
    if (canonicalMapPath !== canonicalEmbeddedPath) {
      throw new Error(
        `Coverage map key and embedded path disagree: ${mapPath} != ${rawFileCoverage.path}`
      )
    }

    const fileCoverage = structuredClone(rawFileCoverage)
    fileCoverage.path = canonicalMapPath
    // Vite Istanbul has already applied this map when it produced the original
    // TS/TSX statement locations. Keeping it makes NYC remap the canonical
    // relative path a second time and reintroduce the absolute workspace path.
    delete fileCoverage.inputSourceMap
    canonicalMap.addFileCoverage(fileCoverage)
  }

  return canonicalMap.toJSON()
}

export function mergeCoverageMaps(rawMaps, rootPath) {
  const merged = createCoverageMap({})

  for (const rawMap of rawMaps) {
    merged.merge(canonicalizeCoverageMap(rawMap, rootPath))
  }

  return merged.toJSON()
}
