/**
 * SiteIntegrationManagementTab - Site integration management with search and overrides
 */

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search } from "lucide-react"
import { SiteIntegrationCard } from "../components/SiteIntegrationCard"
import { SITE_INTEGRATION_MANIFESTS } from "@/src/site-integrations/manifest"
import type { SiteOverrideRecord } from "@/src/storage/site-overrides-service"
import type { SiteIntegrationEnablementMap } from "@/src/storage/site-integration-enablement-service"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { SiteIntegrationSettingValue } from "@/src/storage/site-integration-settings-service"
import { t } from '@/src/shared/i18n'

type CustomSettingValue = SiteIntegrationSettingValue

interface SiteIntegrationManagementTabProps {
  overrides: Record<string, SiteOverrideRecord>
  siteIntegrationEnablement: SiteIntegrationEnablementMap
  globalSettings: ExtensionSettings
  siteIntegrationSettingsByIntegration: Record<string, Record<string, CustomSettingValue>>
  onSiteIntegrationSettingsChange: (siteIntegrationId: string, settingId: string, enabled: boolean, value: CustomSettingValue) => void
  onSiteIntegrationEnablementChange: (siteIntegrationId: string, enabled: boolean) => void
  onChange: (siteIntegrationId: string, override: SiteOverrideRecord | null) => void
}

export function SiteIntegrationManagementTab({
  overrides,
  siteIntegrationEnablement,
  globalSettings,
  siteIntegrationSettingsByIntegration,
  onSiteIntegrationSettingsChange,
  onSiteIntegrationEnablementChange,
  onChange
}: SiteIntegrationManagementTabProps) {
  const [search, setSearch] = useState('')

  // Build from the manifest SSOT so the tab is not coupled to async registry initialization.
  const integrations = useMemo(() => {
    return SITE_INTEGRATION_MANIFESTS
      .filter((manifest) => manifest.enabled !== false)
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        domains: manifest.patterns.domains,
        customSettings: manifest.customSettings,
        policyDefaults: manifest.policyDefaults,
      }))
  }, [])

  // Filter integrations by search query (name or domain)
  const filteredIntegrations = integrations.filter(integration => {
    const query = search.toLowerCase().trim()
    if (!query) return true

    return (
      integration.name.toLowerCase().includes(query) ||
      integration.domains.some(d => d.toLowerCase().includes(query))
    )
  })

  // Sort: overrides first, then alphabetically
  const sortedIntegrations = useMemo(() => {
    return [...filteredIntegrations].sort((a, b) => {
      const aHasOverride = !!overrides[a.id]
      const bHasOverride = !!overrides[b.id]

      if (aHasOverride && !bHasOverride) return -1
      if (!aHasOverride && bHasOverride) return 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredIntegrations, overrides])

  // Global defaults to pass to site integration cards
  const globalDefaults = {
    outputFormat: globalSettings.downloads.defaultFormat,
    imagePolicy: globalSettings.globalPolicy.image,
    chapterPolicy: globalSettings.globalPolicy.chapter
  }

  // Count total overrides
  const overrideCount = Object.keys(overrides).length

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-foreground">{t('options_siteIntegrations')}</h2>
            <Badge variant="secondary" className="h-5 px-2 text-[10px] font-medium text-muted-foreground">
              {t('options_integrationsCount', [String(sortedIntegrations.length)])}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t('options_siteIntegrationsDesc')}
          </p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('options_searchSiteIntegrations')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 border-border/70 bg-background pl-9 text-sm"
          />
        </div>

        {/* Override Summary Banner */}
        {overrideCount > 0 && (
          <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <Badge variant="outline" className="mr-2 border-primary/40 bg-transparent text-[10px] font-medium text-current">
              {t('options_overrides')}
            </Badge>
            {t('options_activeOverrides', [String(overrideCount), overrideCount !== 1 ? t('options_integrationsPlural') : t('options_integrationSingular')])}
          </div>
        )}

        {/* Site Integration List */}
        <div className="min-w-0 flex flex-col gap-4">
          {sortedIntegrations.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/80 bg-muted/10 py-12 text-center">
              <div className="text-muted-foreground">
                {search ? (
                  <>
                    <p className="font-medium text-foreground">{t('options_noIntegrationsFound')}</p>
                    <p className="mt-1 text-sm">{t('options_trySearchingElse')}</p>
                  </>
                ) : (
                  <p>{t('options_noIntegrationsAvailable')}</p>
                )}
              </div>
            </div>
          ) : (
            sortedIntegrations.map(integration => (
              <SiteIntegrationCard
                key={integration.id}
                siteIntegration={integration}
                isEnabled={siteIntegrationEnablement[integration.id] ?? true}
                override={overrides[integration.id]}
                globalDefaults={globalDefaults}
                siteIntegrationSettingsValues={siteIntegrationSettingsByIntegration[integration.id]}
                onSiteIntegrationSettingsChange={onSiteIntegrationSettingsChange}
                onEnabledChange={onSiteIntegrationEnablementChange}
                onChange={onChange}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

