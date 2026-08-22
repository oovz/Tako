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
import { cn } from "@/src/shared/utils"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"

type CustomSettingValue = SiteIntegrationSettingValue
type FilterType = "all" | "enabled" | "disabled" | "overrides"

interface SiteIntegrationsTabProps {
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

export function SiteIntegrationsTab({
  overrides,
  siteIntegrationEnablement,
  globalSettings,
  siteIntegrationSettingsByIntegration,
  onSiteIntegrationSettingsChange,
  onSiteIntegrationEnablementChange,
  onChange,
}: SiteIntegrationsTabProps) {
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<FilterType>("all")

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

  // Filter counts
  const enabledCount = useMemo(() => {
    return integrations.filter((i) =>
      isEnabled(i.id, siteIntegrationEnablement)
    ).length
  }, [integrations, siteIntegrationEnablement])

  const disabledCount = useMemo(() => {
    return integrations.length - enabledCount
  }, [integrations.length, enabledCount])

  const overridesCount = useMemo(() => {
    return new Set([
      ...Object.keys(overrides),
      ...Object.entries(siteIntegrationSettingsByIntegration)
        .filter(([, values]) => Object.keys(values).length > 0)
        .map(([integrationId]) => integrationId),
    ]).size
  }, [overrides, siteIntegrationSettingsByIntegration])

  // Filter integrations by search query and active filter
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      const query = search.toLowerCase().trim()
      const matchesQuery =
        !query ||
        integration.name.toLowerCase().includes(query) ||
        integration.domains.some((d) => d.toLowerCase().includes(query)) ||
        integration.contributors?.some((c) => c.toLowerCase().includes(query))

      if (!matchesQuery) return false

      if (activeFilter === "enabled") {
        return isEnabled(integration.id, siteIntegrationEnablement)
      }
      if (activeFilter === "disabled") {
        return !isEnabled(integration.id, siteIntegrationEnablement)
      }
      if (activeFilter === "overrides") {
        return (
          !!overrides[integration.id] ||
          Object.keys(
            siteIntegrationSettingsByIntegration[integration.id] ?? {}
          ).length > 0
        )
      }

      return true
    })
  }, [
    integrations,
    search,
    activeFilter,
    siteIntegrationEnablement,
    overrides,
    siteIntegrationSettingsByIntegration,
  ])

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

  const globalDefaults = {
    outputFormat: globalSettings.downloads.defaultFormat,
    imagePolicy: globalSettings.globalPolicy.image,
    chapterPolicy: globalSettings.globalPolicy.chapter,
    retries: globalSettings.globalRetries,
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsSectionHeader
        id="options-integrations-heading"
        title={t("options_siteIntegrations")}
        description={t("options_siteIntegrationsDesc")}
        action={
          <Badge variant="secondary" className="h-6 px-2.5 text-xs font-medium">
            {t("options_integrationsCount", [String(integrations.length)])}
          </Badge>
        }
      />

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("options_searchSiteIntegrations")}
            placeholder={t("options_searchSiteIntegrations")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9.5 pl-9 text-sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className={cn(
              "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.96] cursor-pointer",
              activeFilter === "all"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t("common_all")} ({integrations.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("enabled")}
            className={cn(
              "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.96] cursor-pointer",
              activeFilter === "enabled"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t("common_enabled")} ({enabledCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("disabled")}
            className={cn(
              "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.96] cursor-pointer",
              activeFilter === "disabled"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t("common_disabled")} ({disabledCount})
          </button>

          {overridesCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveFilter("overrides")}
              className={cn(
                "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.96] cursor-pointer",
                activeFilter === "overrides"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {t("common_overrides")} ({overridesCount})
            </button>
          )}
        </div>
      </div>

      {/* Active Overrides Summary Banner */}
      {overridesCount > 0 && activeFilter !== "overrides" && (
        <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary/40 bg-background text-[10px] font-semibold text-primary"
            >
              {t("options_overrides")}
            </Badge>
            <span>
              {t("options_activeOverrides", [
                String(overridesCount),
                overridesCount !== 1
                  ? t("options_integrationsPlural")
                  : t("options_integrationSingular"),
              ])}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveFilter("overrides")}
            className="text-xs font-medium text-primary hover:underline cursor-pointer"
          >
            {t("common_show") || "View"}
          </button>
        </div>
      )}

      {/* Site Integration List */}
      <div className="min-w-0 flex flex-col gap-4">
        {sortedIntegrations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center">
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
              onSiteIntegrationSettingsChange={onSiteIntegrationSettingsChange}
              onEnabledChange={onSiteIntegrationEnablementChange}
              onChange={onChange}
            />
          ))
        )}
      </div>
    </div>
  )
}
