import { describe, expect, it, vi } from 'vitest'

import { writeBlobToPath } from '@/src/storage/fs-access'

vi.mock('@/src/runtime/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function createNamedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

type DirectoryHandleOptions = Partial<FileSystemDirectoryHandle> & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

function createDirectoryHandle(
  getFileHandle: (name: string) => Promise<unknown> = async () => {
    throw createNamedError('NotFoundError')
  },
  options: DirectoryHandleOptions = {},
): FileSystemDirectoryHandle {
  return {
    name: 'downloads',
    getFileHandle,
    entries: async function* () {
      yield ['existing', {} as FileSystemFileHandle]
    },
    ...options,
  } as FileSystemDirectoryHandle
}

describe('writeBlobToPath with overwriteExisting: false', () => {
  it('generates a unique filename when overwriteExisting is false', async () => {
    const existing = new Set(['Chapter 001.cbz'])
    const requestedFiles: string[] = []
    const dir = createDirectoryHandle(async (name: string, opts?: { create?: boolean }) => {
      if (opts?.create) {
        requestedFiles.push(name)
        return {
          createWritable: async () => ({
            write: vi.fn(),
            close: vi.fn(),
          }),
        }
      }
      if (existing.has(name)) return {}
      throw createNamedError('NotFoundError')
    }, {
      getDirectoryHandle: async () => dir,
    })
    const blob = new Blob(['chapter'])

    await writeBlobToPath(dir, 'Chapter 001.cbz', blob, false)

    expect(requestedFiles).toContain('Chapter 001 (1).cbz')
  })

  it('writes directly when overwriteExisting is true (default)', async () => {
    const requestedFiles: string[] = []
    const dir = createDirectoryHandle(async (name) => {
      requestedFiles.push(name)
      return {
        createWritable: async () => ({
          write: vi.fn(),
          close: vi.fn(),
        }),
      }
    }, {
      getDirectoryHandle: async () => dir,
    })
    const blob = new Blob(['chapter'])

    await writeBlobToPath(dir, 'Chapter 001.cbz', blob, true)

    expect(requestedFiles).toEqual(['Chapter 001.cbz'])
  })
})
