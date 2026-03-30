import { describe, expect, it } from 'vitest'
import { SettingsSyncService } from '@/src/storage/settings-sync-service'
import { mocks } from './settings-sync-test-setup'

export function registerSettingsSyncValidationCases(): void {
  describe('SettingsSyncService behavior', () => {
    it('validates custom mode requires a configured folder handle', async () => {
      const service = new SettingsSyncService()
      mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

      const validation = await service.validateDownloadMode('custom')

      expect(validation).toEqual({
        isValid: false,
        error: 'Custom download mode requires a folder to be selected. Please choose a folder first.',
      })
    })

    it('accepts custom mode when folder handle exists and permission is granted', async () => {
      const service = new SettingsSyncService()
      mocks.loadDownloadRootHandle.mockResolvedValue({} as FileSystemDirectoryHandle)
      mocks.verifyPermission.mockResolvedValue(true)

      const validation = await service.validateDownloadMode('custom')

      expect(validation).toEqual({ isValid: true })
      expect(mocks.verifyPermission).toHaveBeenCalledWith(expect.anything(), true)
    })
  })
}
