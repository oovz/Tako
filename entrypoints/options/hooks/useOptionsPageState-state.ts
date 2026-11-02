import { useEffect, useReducer, useRef } from "react"
import {
  initialOptionsConfigurationState,
  optionsConfigurationReducer,
  optionsConfigurationSnapshotsEqual,
  type OptionsConfigurationState,
} from "../state/options-configuration-reducer"

export function useOptionsConfigurationState() {
  const [configuration, dispatchConfiguration] = useReducer(
    optionsConfigurationReducer,
    initialOptionsConfigurationState
  )
  const configurationRef = useRef(configuration)
  useEffect(() => {
    configurationRef.current = configuration
  }, [configuration])
  return { configuration, dispatchConfiguration, configurationRef }
}

export function optionsSavedView(configuration: OptionsConfigurationState) {
  return {
    settings: configuration.saved?.settings ?? null,
    savedSiteIntegrationEnablement: configuration.saved?.enablement ?? {},
  }
}

export function optionsDraftView(configuration: OptionsConfigurationState) {
  const draft = configuration.draft
  return {
    settingsBuffer: draft?.settings ?? null,
    overrides: draft?.overrides ?? {},
    siteIntegrationEnablement: draft?.enablement ?? {},
    siteIntegrationSettingsByIntegration: draft?.integrationSettings ?? {},
  }
}

export function optionsHasUnsavedChanges(
  configuration: OptionsConfigurationState,
  hasPendingFolder: boolean
): boolean {
  return (
    configuration.saved !== null &&
    configuration.draft !== null &&
    (hasPendingFolder ||
      !optionsConfigurationSnapshotsEqual(
        configuration.saved,
        configuration.draft
      ))
  )
}

export type OptionsConfigurationBinding = ReturnType<
  typeof useOptionsConfigurationState
>
