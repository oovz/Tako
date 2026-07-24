import { describe, expect, it } from "vitest"
import { t } from "@/src/runtime/i18n"
import { SettingsSyncService } from "@/src/storage/settings-sync-service"
import { mocks } from "./settings-sync-test-setup"

export function registerSettingsSyncValidationCases(): void {
  describe("SettingsSyncService behavior", () => {
    it("validates that File System Access requires a configured folder handle", async () => {
      const service = new SettingsSyncService()
      mocks.loadDownloadRootHandle.mockResolvedValue(undefined)

      const validation = await service.validateDestination("file-system-access")

      expect(validation).toEqual({
        isValid: false,
        error: t("settings_customFolderRequired"),
      })
    })

    it("accepts File System Access when the folder permission is granted", async () => {
      const service = new SettingsSyncService()
      mocks.loadDownloadRootHandle.mockResolvedValue(
        {} as FileSystemDirectoryHandle
      )
      mocks.verifyPermission.mockResolvedValue(true)

      const validation = await service.validateDestination("file-system-access")

      expect(validation).toEqual({ isValid: true })
      expect(mocks.verifyPermission).toHaveBeenCalledWith(
        expect.anything(),
        true
      )
    })

    it("reports lost permission without mutating the configured destination", async () => {
      const service = new SettingsSyncService()
      mocks.loadDownloadRootHandle.mockResolvedValue(
        {} as FileSystemDirectoryHandle
      )
      mocks.verifyPermission.mockResolvedValue(false)

      const validation = await service.validateDestination("file-system-access")

      expect(validation).toEqual({
        isValid: false,
        error: t("settings_customFolderPermissionDenied"),
      })
      expect(mocks.updateSettings).not.toHaveBeenCalled()
    })
  })
}
