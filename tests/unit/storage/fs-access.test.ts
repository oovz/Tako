import { describe, expect, it } from 'vitest'

import {
  checkPermissionBeforeWrite,
  generateUniqueFilename,
  verifyPermission,
  writeBlobToPath,
} from '@/src/storage/fs-access'
import { DirectoryNotFoundError, PermissionExpiredError } from '@/src/types/errors'

type FileLookup = (name: string) => Promise<unknown>

type DirectoryHandleOptions = Partial<FileSystemDirectoryHandle> & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

function createDirectoryHandle(
  getFileHandle: FileLookup = async () => {
    throw createNamedError('NotFoundError')
  },
  options: DirectoryHandleOptions = {}
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

function createNamedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

describe('File System Access helpers', () => {
  describe('generateUniqueFilename', () => {
    it('returns the original filename when no existing file is found', async () => {
      const dir = createDirectoryHandle(async () => {
        throw createNamedError('NotFoundError')
      })

      await expect(generateUniqueFilename(dir, 'Chapter 001.cbz')).resolves.toBe('Chapter 001.cbz')
    })

    it('increments before the extension until a missing filename is found', async () => {
      const existing = new Set(['Chapter 001.cbz', 'Chapter 001 (1).cbz', 'Chapter 001 (2).cbz'])
      const dir = createDirectoryHandle(async (name) => {
        if (existing.has(name)) return {}
        throw createNamedError('NotFoundError')
      })

      await expect(generateUniqueFilename(dir, 'Chapter 001.cbz')).resolves.toBe('Chapter 001 (3).cbz')
    })

    it('propagates non-missing lookup failures instead of treating them as available filenames', async () => {
      const dir = createDirectoryHandle(async () => {
        throw createNamedError('NotAllowedError')
      })

      await expect(generateUniqueFilename(dir, 'Chapter 001.cbz')).rejects.toMatchObject({
        name: 'NotAllowedError',
      })
    })

    it('stops after the configured collision limit without returning an existing filename', async () => {
      const dir = createDirectoryHandle(async () => ({}))

      await expect(generateUniqueFilename(dir, 'Chapter 001.cbz')).rejects.toThrow(
        'Cannot generate unique filename after 999 attempts'
      )
    })
  })

  describe('verifyPermission', () => {
    it('uses readwrite permission when checking writable access', async () => {
      const calls: Array<{ mode: string }> = []
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async (descriptor) => {
          calls.push(descriptor)
          return 'granted'
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(true)
      expect(calls).toEqual([{ mode: 'readwrite' }])
    })

    it('requests permission when the current state is not already granted', async () => {
      const requests: Array<{ mode: string }> = []
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => 'prompt',
        requestPermission: async (descriptor) => {
          requests.push(descriptor)
          return 'granted'
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(true)
      expect(requests).toEqual([{ mode: 'readwrite' }])
    })

    it('returns false when permission checks fail', async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => {
          throw createNamedError('NotAllowedError')
        },
      })

      await expect(verifyPermission(dir)).resolves.toBe(false)
    })
  })

  describe('checkPermissionBeforeWrite', () => {
    it('returns when the directory exists and write permission is already granted', async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => 'granted',
      })

      await expect(checkPermissionBeforeWrite(dir)).resolves.toBeUndefined()
    })

    it('requests write permission for prompt state and accepts granted responses', async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => 'prompt',
        requestPermission: async () => 'granted',
      })

      await expect(checkPermissionBeforeWrite(dir)).resolves.toBeUndefined()
    })

    it('rejects with a permission error when write access is denied', async () => {
      const dir = createDirectoryHandle(undefined, {
        queryPermission: async () => 'denied',
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(PermissionExpiredError)
    })

    it('rejects with a directory error when the stored handle no longer resolves', async () => {
      const dir = createDirectoryHandle(undefined, {
        entries: (() =>
          ({
            async next() {
              throw createNamedError('NotFoundError')
            },
            [Symbol.asyncIterator]() {
              return this
            },
          }) as unknown as ReturnType<FileSystemDirectoryHandle['entries']>) as FileSystemDirectoryHandle['entries'],
      })

      await expect(checkPermissionBeforeWrite(dir)).rejects.toBeInstanceOf(DirectoryNotFoundError)
    })
  })

  describe('writeBlobToPath', () => {
    it('creates nested directories and writes the blob to the leaf file', async () => {
      const written: Blob[] = []
      const closed: string[] = []
      const createdDirectories: string[] = []
      const requestedFiles: string[] = []
      const dir = createDirectoryHandle(
        async (name) => {
          requestedFiles.push(name)
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => {
                written.push(blob)
              },
              close: async () => {
                closed.push(name)
              },
            }),
          }
        },
        {
          getDirectoryHandle: async (name) => {
            createdDirectories.push(name)
            return dir
          },
        }
      )
      const blob = new Blob(['chapter'])

      await writeBlobToPath(dir, 'Series/Volume 1/Chapter 001.cbz', blob)

      expect(createdDirectories).toEqual(['Series', 'Volume 1'])
      expect(requestedFiles).toEqual(['Chapter 001.cbz'])
      expect(written).toEqual([blob])
      expect(closed).toEqual(['Chapter 001.cbz'])
    })
  })
})
