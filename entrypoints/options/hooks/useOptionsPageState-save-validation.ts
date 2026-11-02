import { toast } from "sonner"
import { ExtensionSettingsSchema } from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { validateTemplate } from "@/src/shared/template-expander"
import type { useOptionsFolderManagement } from "./useOptionsFolderManagement"

function validTemplates(settings: ExtensionSettings): boolean {
  const path = validateTemplate(settings.downloads.pathTemplate)
  const filename = validateTemplate(settings.downloads.fileNameTemplate)
  if (path.valid && filename.valid) return true
  toast.error(t("options_invalidTemplate"))
  return false
}

function validSettings(settings: ExtensionSettings): boolean {
  const result = ExtensionSettingsSchema.safeParse(settings)
  if (result.success) return true
  toast.error(t("options_toastSaveFailed"), {
    description:
      result.error.issues[0]?.message ?? t("options_toastUnknownError"),
  })
  return false
}

export function validateOptionsDraft(
  settings: ExtensionSettings,
  folder: ReturnType<typeof useOptionsFolderManagement>
): boolean {
  if (!validTemplates(settings) || !validSettings(settings)) return false
  if (
    settings.downloads.destination === "file-system-access" &&
    !folder.pendingFolderHandle &&
    !folder.savedFolderHandle
  ) {
    toast.error(t("options_toastSaveFailed"), {
      description: t("settings_customFolderRequired"),
    })
    return false
  }
  return true
}
