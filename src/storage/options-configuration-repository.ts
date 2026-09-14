import {
  cloneSettings,
  parseSettingsDocument,
} from "@/src/domain/settings/schema"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type {
  SiteOverridesMap,
  SiteIntegrationEnablementMap,
  SiteIntegrationSettingsMap,
} from "@/src/domain/site-integrations/storage-schemas"
import {
  parseSiteOverridesDocument,
  SITE_OVERRIDES_STORAGE_KEY,
} from "@/src/storage/site-overrides-service"
import {
  parseSiteIntegrationEnablementDocument,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
} from "@/src/storage/site-integration-enablement-service"
import {
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
  parseSiteIntegrationSettingsDocument,
} from "@/src/storage/site-integration-settings-service"
import {
  SETTINGS_STORAGE_KEY,
  type SettingsRepository,
} from "@/src/storage/settings-repository"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"

export interface OptionsConfigurationSnapshot {
  settings: ExtensionSettings
  overrides: SiteOverridesMap
  enablement: SiteIntegrationEnablementMap
  integrationSettings: SiteIntegrationSettingsMap
}

export interface OptionsConfigurationStorage {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}

const CONFIGURATION_STORAGE_KEYS = [
  SETTINGS_STORAGE_KEY,
  SITE_OVERRIDES_STORAGE_KEY,
  SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY,
  SITE_INTEGRATION_SETTINGS_STORAGE_KEY,
] as const

function cloneConfiguration(
  configuration: OptionsConfigurationSnapshot
): OptionsConfigurationSnapshot {
  return {
    settings: cloneSettings(configuration.settings),
    overrides: structuredClone(configuration.overrides),
    enablement: structuredClone(configuration.enablement),
    integrationSettings: structuredClone(configuration.integrationSettings),
  }
}

function parseConfigurationDocument(
  value: Record<string, unknown>
): OptionsConfigurationSnapshot {
  if (!Object.hasOwn(value, SETTINGS_STORAGE_KEY)) {
    throw new Error(`Missing required storage key: ${SETTINGS_STORAGE_KEY}`)
  }
  const settings = parseSettingsDocument(value[SETTINGS_STORAGE_KEY])
  const overrides = Object.hasOwn(value, SITE_OVERRIDES_STORAGE_KEY)
    ? parseSiteOverridesDocument(value[SITE_OVERRIDES_STORAGE_KEY])
    : {}
  const enablement = Object.hasOwn(
    value,
    SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY
  )
    ? parseSiteIntegrationEnablementDocument(
        value[SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]
      )
    : {}
  const integrationSettings = Object.hasOwn(
    value,
    SITE_INTEGRATION_SETTINGS_STORAGE_KEY
  )
    ? parseSiteIntegrationSettingsDocument(
        value[SITE_INTEGRATION_SETTINGS_STORAGE_KEY]
      )
    : {}

  return { settings, overrides, enablement, integrationSettings }
}

function validateConfiguration(
  configuration: OptionsConfigurationSnapshot
): OptionsConfigurationSnapshot {
  return parseConfigurationDocument({
    [SETTINGS_STORAGE_KEY]: configuration.settings,
    [SITE_OVERRIDES_STORAGE_KEY]: configuration.overrides,
    [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: configuration.enablement,
    [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: configuration.integrationSettings,
  })
}

export class OptionsConfigurationRepository {
  private readonly mutations = new StorageMutationQueue()

  constructor(
    private readonly storage: OptionsConfigurationStorage,
    private readonly settingsReader: Pick<SettingsRepository, "getSettings">
  ) {}

  async get(): Promise<OptionsConfigurationSnapshot> {
    return await this.mutations.run(async () => {
      const stored = await this.storage.get([...CONFIGURATION_STORAGE_KEYS])
      const initialized = Object.hasOwn(stored, SETTINGS_STORAGE_KEY)
        ? stored
        : {
            ...stored,
            [SETTINGS_STORAGE_KEY]: await this.settingsReader.getSettings(),
          }
      return parseConfigurationDocument(initialized)
    })
  }

  async save(
    next: OptionsConfigurationSnapshot
  ): Promise<OptionsConfigurationSnapshot> {
    const validated = validateConfiguration(next)
    await this.mutations.run(async () => {
      await this.storage.set({
        [SETTINGS_STORAGE_KEY]: validated.settings,
        [SITE_OVERRIDES_STORAGE_KEY]: validated.overrides,
        [SITE_INTEGRATION_ENABLEMENT_STORAGE_KEY]: validated.enablement,
        [SITE_INTEGRATION_SETTINGS_STORAGE_KEY]: validated.integrationSettings,
      })
    })
    return cloneConfiguration(validated)
  }
}
