import { useState, type RefObject } from "react"
import { toast } from "sonner"
import logger from "@/src/runtime/logger"
import { t } from "@/src/runtime/i18n"
import { validateSettingsDestination } from "@/src/storage/settings-destination-validation"
import type { DirHandle } from "@/src/storage/fs-access"
import {
  optionsConfigurationSnapshotsEqual,
  type OptionsConfigurationSnapshot,
} from "../state/options-configuration-reducer"
import type { OptionsConfigurationClient } from "../controllers/options-configuration-client"
import type { OptionsExternalChangeController } from "../controllers/options-external-change-controller"
import type { OptionsHostPermissionController } from "../controllers/options-host-permission-controller"
import type { OptionsFsaController } from "../controllers/options-fsa-controller"
import type { OptionsConfigurationBinding } from "./useOptionsPageState-state"
import type { useOptionsFolderManagement } from "./useOptionsFolderManagement"
import { validateOptionsDraft } from "./useOptionsPageState-save-validation"

type Folder = ReturnType<typeof useOptionsFolderManagement>
export interface OptionsSaveDependencies extends OptionsConfigurationBinding {
  client: OptionsConfigurationClient
  external: OptionsExternalChangeController
  permissions: OptionsHostPermissionController
  fsa: OptionsFsaController
  folder: Folder
  isSavingRef: RefObject<boolean>
  isResolvingExternalChanges: boolean
}
interface Submission {
  configuration: OptionsConfigurationSnapshot
  revision: number
  handle: DirHandle | null
  pendingHandle: DirHandle | null
}

function captureSubmission(
  draft: OptionsConfigurationSnapshot,
  saved: OptionsConfigurationSnapshot,
  revision: number,
  folder: Folder
): Submission {
  const custom = draft.settings.downloads.destination === "file-system-access"
  const pendingHandle = custom ? folder.pendingFolderHandle : null
  const handleId = pendingHandle
    ? crypto.randomUUID()
    : saved.settings.downloads.customDirectoryHandleId
  return {
    revision,
    pendingHandle,
    handle: custom
      ? (folder.pendingFolderHandle ?? folder.savedFolderHandle)
      : null,
    configuration: {
      ...draft,
      settings: {
        ...draft.settings,
        downloads: {
          ...draft.settings.downloads,
          customDirectoryHandleId: custom ? handleId : null,
        },
      },
    },
  }
}

function canSubmit(options: OptionsSaveDependencies): boolean {
  if (options.isSavingRef.current || options.folder.isPickingFolderRef.current)
    return false
  if (
    options.configuration.externalChangeKeys.length > 0 ||
    options.isResolvingExternalChanges
  ) {
    toast.error(t("options_externalChangesSaveBlocked"))
    return false
  }
  return true
}

async function persistSubmission(
  submitted: Submission,
  options: OptionsSaveDependencies
): Promise<OptionsConfigurationSnapshot> {
  const validation = await validateSettingsDestination(
    submitted.configuration.settings.downloads.destination,
    submitted.handle
  )
  if (!validation.isValid)
    throw new Error(validation.error ?? t("options_toastSaveFailed"))
  if (submitted.pendingHandle)
    await options.fsa.stage(
      submitted.pendingHandle,
      submitted.configuration.settings.downloads.customDirectoryHandleId!
    )
  const response = await options.client.save(submitted.configuration)
  try {
    await options.permissions.removeUnused(submitted.configuration.enablement)
  } catch (error) {
    // Disabled integrations stay disabled when permission removal needs a later retry.
    logger.warn("Failed to remove unused HTTPS host permission:", error)
  }
  return response
}

function reportSaveFailure(error: unknown): void {
  logger.error("[OPTIONS] Failed to save settings:", error)
  const description =
    error instanceof Error && error.message
      ? error.message
      : t("options_toastUnknownError")
  toast.error(t("options_toastSaveFailed"), { description })
}

export function useOptionsSave(options: OptionsSaveDependencies) {
  const { isSavingRef } = options
  const [isSaving, setIsSaving] = useState(false)
  async function saveConfiguration(): Promise<void> {
    const { saved, draft, draftRevision } = options.configuration
    if (!saved || !draft) return
    if (
      !canSubmit(options) ||
      !validateOptionsDraft(draft.settings, options.folder)
    )
      return
    const submitted = captureSubmission(
      draft,
      saved,
      draftRevision,
      options.folder
    )
    const saveToken = options.external.beginSave(submitted.configuration, {
      expectStorageChange: !optionsConfigurationSnapshotsEqual(
        saved,
        submitted.configuration
      ),
    })
    let saveSucceeded = false
    try {
      isSavingRef.current = true
      setIsSaving(true)
      const persisted = await persistSubmission(submitted, options)
      options.dispatchConfiguration({
        type: "save-commit",
        submitted: submitted.configuration,
        submittedRevision: submitted.revision,
        persisted,
      })
      options.folder.setSavedFolderHandle(submitted.handle)
      if (options.configurationRef.current.draftRevision === submitted.revision)
        options.folder.setPendingFolderHandle(null)
      saveSucceeded = true
      toast.success(t("options_toastSavedSuccessfully"))
    } catch (error) {
      reportSaveFailure(error)
    } finally {
      options.external.completeSave(saveToken, saveSucceeded)
      isSavingRef.current = false
      setIsSaving(false)
    }
  }
  return { isSaving, saveConfiguration }
}
