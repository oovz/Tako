import type {
  SiteIntegrationSettingValue,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import type { SiteIntegrationSettingsField as SettingsFieldSchema } from "@/src/site-integrations/definition-types"
type CustomSettingValue = SiteIntegrationSettingValue

export interface SiteIntegrationInfo {
  id: string
  name: string
  contributors?: readonly string[] | string[]
  domains: string[]
  customSettings?: SettingsFieldSchema[]
  requiresBroadHttpsPermission?: boolean
  policyDefaults?: {
    image?: Partial<RateScopePolicy>
    chapter?: Partial<RateScopePolicy>
  }
}

export interface SiteIntegrationCardProps {
  siteIntegration: SiteIntegrationInfo
  isEnabled: boolean
  override?: SiteOverrideRecord
  globalDefaults: {
    outputFormat: "cbz" | "zip" | "none"
    imagePolicy: RateScopePolicy
    chapterPolicy: RateScopePolicy
    retries?: { image: number; chapter: number }
  }
  siteIntegrationSettingsValues?: Record<string, CustomSettingValue>
  onEnabledChange?: (
    siteIntegrationId: string,
    enabled: boolean
  ) => void | Promise<void>
  onSiteIntegrationSettingsChange?: (
    siteIntegrationId: string,
    settingId: string,
    value: CustomSettingValue | undefined
  ) => void
  onChange: (
    siteIntegrationId: string,
    override: SiteOverrideRecord | null
  ) => void
}
