/**
 * SiteIntegrationManagementTab - Site integration management with search and overrides
 */

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search } from "lucide-react"
import { SiteIntegrationCard } from "../components/SiteIntegrationCard"
import {
  isEnabled,
  requiresBroadHttpsPermission,
  siteIntegrationCatalog,
} from "@/src/site-integrations/catalog"
import type {
  SiteIntegrationEnablementMap,
  SiteIntegrationSettingValue,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"

type CustomSettingValue = SiteIntegrationSettingValue

interface SiteIntegrationManagementTabProps {
  overrides: Record<string, SiteOverrideRecord>
  siteIntegrationEnablement: SiteIntegrationEnablementMap
  globalSettings: ExtensionSettings
  siteIntegrationSettingsByIntegration: Record<
    string,
    Record<string, CustomSettingValue>
  >
  onSiteIntegrationSettingsChange: (
    siteIntegrationId: string,
    settingId: string,
    enabled: boolean,
    value: CustomSettingValue
  ) => void
  onSiteIntegrationEnablementChange: (
    siteIntegrationId: string,
    enabled: boolean
  ) => void | Promise<void>
  onChange: (
    siteIntegrationId: string,
    override: SiteOverrideRecord | null
  ) => void
}

export function SiteIntegrationManagementTab({
  overrides,
  siteIntegrationEnablement,
  globalSettings,
  siteIntegrationSettingsByIntegration,
  onSiteIntegrationSettingsChange,
  onSiteIntegrationEnablementChange,
  onChange,
}: SiteIntegrationManagementTabProps) {
  const [search, setSearch] = useState("")

  // Build from the manifest SSOT so the tab is not coupled to async registry initialization.
  const integrations = useMemo(() => {
    return siteIntegrationCatalog
      .filter((manifest) => manifest.shipped)
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        contributors: manifest.contributors,
        domains: manifest.patterns.domains,
        customSettings: manifest.customSettings,
        policyDefaults: manifest.policyDefaults,
        requiresBroadHttpsPermission: requiresBroadHttpsPermission(manifest.id),
      }))
  }, [])

  // Filter integrations by deferred search query (name or domain)
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      const query = search.toLowerCase().trim()
      if (!query) return true

      return (
        integration.name.toLowerCase().includes(query) ||
        integration.domains.some((d) => d.toLowerCase().includes(query)) ||
        integration.contributors?.some((c) => c.toLowerCase().includes(query))
      )
    })
  }, [integrations, search])

  // Sort: overrides first, then alphabetically
  const sortedIntegrations = useMemo(() => {
    return [...filteredIntegrations].sort((a, b) => {
      const aHasOverride =
        !!overrides[a.id] ||
        Object.keys(siteIntegrationSettingsByIntegration[a.id] ?? {}).length > 0
      const bHasOverride =
        !!overrides[b.id] ||
        Object.keys(siteIntegrationSettingsByIntegration[b.id] ?? {}).length > 0

      if (aHasOverride && !bHasOverride) return -1
      if (!aHasOverride && bHasOverride) return 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredIntegrations, overrides, siteIntegrationSettingsByIntegration])

  // Global defaults to pass to site integration cards
  const globalDefaults = {
    outputFormat: globalSettings.downloads.defaultFormat,
    imagePolicy: globalSettings.globalPolicy.image,
    chapterPolicy: globalSettings.globalPolicy.chapter,
    retries: globalSettings.globalRetries,
  }

  // Count total overrides
  const overrideCount = new Set([
    ...Object.keys(overrides),
    ...Object.entries(siteIntegrationSettingsByIntegration)
      .filter(([, values]) => Object.keys(values).length > 0)
      .map(([integrationId]) => integrationId),
  ]).size

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              id="options-integrations-heading"
              className="text-2xl font-semibold text-foreground"
            >
              {t("options_siteIntegrations")}
            </h1>
            <Badge
              variant="secondary"
              className="h-5 px-2 text-[10px] font-medium text-muted-foreground"
            >
              {t("options_integrationsCount", [
                String(sortedIntegrations.length),
              ])}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("options_siteIntegrationsDesc")}
          </p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("options_searchSiteIntegrations")}
            placeholder={t("options_searchSiteIntegrations")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 border-border/70 bg-background pl-9 text-sm"
          />
        </div>

        {/* Override Summary Banner */}
        {overrideCount > 0 && (
          <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <Badge
              variant="outline"
              className="mr-2 border-primary/40 bg-transparent text-[10px] font-medium text-current"
            >
              {t("options_overrides")}
            </Badge>
            {t("options_activeOverrides", [
              String(overrideCount),
              overrideCount !== 1
                ? t("options_integrationsPlural")
                : t("options_integrationSingular"),
            ])}
          </div>
        )}

        {/* Site Integration List */}
        <div className="min-w-0 flex flex-col gap-4">
          {sortedIntegrations.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/80 bg-muted/10 py-12 text-center">
              <div className="text-muted-foreground">
                {search ? (
                  <>
                    <p className="font-medium text-foreground">
                      {t("options_noIntegrationsFound")}
                    </p>
                    <p className="mt-1 text-sm">
                      {t("options_trySearchingElse")}
                    </p>
                  </>
                ) : (
                  <p>{t("options_noIntegrationsAvailable")}</p>
                )}
              </div>
            </div>
          ) : (
            sortedIntegrations.map((integration) => (
              <SiteIntegrationCard
                key={integration.id}
                siteIntegration={integration}
                isEnabled={isEnabled(integration.id, siteIntegrationEnablement)}
                override={overrides[integration.id]}
                globalDefaults={globalDefaults}
                siteIntegrationSettingsValues={
                  siteIntegrationSettingsByIntegration[integration.id]
                }
                onSiteIntegrationSettingsChange={
                  onSiteIntegrationSettingsChange
                }
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
