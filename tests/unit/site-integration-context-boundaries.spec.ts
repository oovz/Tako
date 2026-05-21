import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const sourceExtensions = ['.ts', '.tsx']

function toProjectPath(filePath: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
}

function resolveSourceFile(candidate: string): string | null {
  if (path.extname(candidate)) {
    return fs.existsSync(candidate) ? candidate : null
  }

  for (const extension of sourceExtensions) {
    const withExtension = `${candidate}${extension}`
    if (fs.existsSync(withExtension)) {
      return withExtension
    }
  }

  for (const extension of sourceExtensions) {
    const indexFile = path.join(candidate, `index${extension}`)
    if (fs.existsSync(indexFile)) {
      return indexFile
    }
  }

  return null
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return resolveSourceFile(path.join(workspaceRoot, specifier.slice(2)))
  }

  if (specifier.startsWith('.')) {
    return resolveSourceFile(path.resolve(path.dirname(fromFile), specifier))
  }

  return null
}

function readImportSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8')
  const specifiers: string[] = []
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier) {
      specifiers.push(specifier)
    }
  }

  return specifiers
}

function collectReachableSourceFiles(rootFiles: string[]): string[] {
  const seen = new Set<string>()
  const queue = rootFiles.map((file) => path.join(workspaceRoot, file))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || seen.has(current) || !fs.existsSync(current)) {
      continue
    }

    seen.add(current)

    for (const specifier of readImportSpecifiers(current)) {
      const resolved = resolveImport(current, specifier)
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  return Array.from(seen).map(toProjectPath).sort()
}

function expectNoReachableFiles(
  reachableFiles: string[],
  forbiddenPattern: RegExp,
  contextName: string,
): void {
  const forbiddenFiles = reachableFiles.filter((file) => forbiddenPattern.test(file))
  expect(forbiddenFiles, `${contextName} reached wrong-context files:\n${forbiddenFiles.join('\n')}`).toEqual([])
}

describe('site integration context boundaries', () => {
  it('keeps content, background, and offscreen site runtime graphs separated', () => {
    const contentFiles = collectReachableSourceFiles([
      'entrypoints/content/content-runtime.ts',
      'src/runtime/site-integration-content-initialization.ts',
    ])
    const backgroundFiles = collectReachableSourceFiles([
      'entrypoints/background/background-startup.ts',
      'entrypoints/background/background-message-router.ts',
      'entrypoints/background/download-queue-runner.ts',
      'src/runtime/background-site-integration-initialization.ts',
    ])
    const offscreenFiles = collectReachableSourceFiles([
      'entrypoints/offscreen/main.ts',
      'src/runtime/site-integration-offscreen-initialization.ts',
    ])

    expectNoReachableFiles(
      contentFiles,
      /^src\/site-integrations\/[^/]+\/(?:background|offscreen)-runtime\.ts$/,
      'content',
    )
    expectNoReachableFiles(
      backgroundFiles,
      /^src\/site-integrations\/[^/]+\/(?:content|offscreen)-runtime\.ts$/,
      'background',
    )
    expectNoReachableFiles(
      offscreenFiles,
      /^src\/site-integrations\/[^/]+\/(?:content|background)-runtime\.ts$/,
      'offscreen',
    )
  })

  it('does not use dynamic site runtime loading in production source', () => {
    const runtimeFiles = collectReachableSourceFiles([
      'entrypoints/content/content-runtime.ts',
      'entrypoints/background/background-startup.ts',
      'entrypoints/offscreen/main.ts',
    ])
    const offenders = runtimeFiles.filter((file) => {
      const source = fs.readFileSync(path.join(workspaceRoot, file), 'utf8')
      return /import\.meta\.glob|import\s*\(\s*['"][^'"]*site-integration/.test(source)
    })

    expect(offenders, `Dynamic site runtime loading found:\n${offenders.join('\n')}`).toEqual([])
  })
})
