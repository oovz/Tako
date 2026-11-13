import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Search, SlidersHorizontal } from "lucide-react"
import { SiteIntegrationCard } from "../components/SiteIntegrationCard"
import {
  getOverriddenIntegrationIds,
  getSiteIntegrationList,
  type IntegrationFilter,
} from "./SiteIntegrationsTab-model"
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
    value: CustomSettingValue | undefined
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
  const [activeFilter, setActiveFilter] = useState<IntegrationFilter>("all")
  const overriddenIds = useMemo(
    () => getOverriddenIntegrationIds(overrides),
    [overrides]
  )
  const { integrations, visibleIntegrations, enabledCount } = useMemo(
    () =>
      getSiteIntegrationList({
        search,
        filter: activeFilter,
        enablement: siteIntegrationEnablement,
        overriddenIds,
      }),
    [search, activeFilter, siteIntegrationEnablement, overriddenIds]
  )
  const disabledCount = integrations.length - enabledCount
  const overridesCount = overriddenIds.size

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
      />

      {/* Search & Filter Toolbar */}
      <div className="options-integrations-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 max-w-md flex-[1_1_16rem]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("options_searchSiteIntegrations")}
            placeholder={t("options_searchSiteIntegrations")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9.5 pl-9 text-sm"
          />
        </div>

        <IntegrationFilters
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          counts={{
            all: integrations.length,
            enabled: enabledCount,
            disabled: disabledCount,
            overrides: overridesCount,
          }}
        />
      </div>

      {/* Active Overrides Summary Banner */}
      {overridesCount > 0 && activeFilter !== "overrides" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2">
            <SlidersHorizontal
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>
              {overridesCount === 1
                ? t("options_activeOverrideSingle")
                : t("options_activeOverrides", String(overridesCount))}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveFilter("overrides")}
            className="shrink-0 cursor-pointer text-xs font-medium text-primary hover:underline"
          >
            {t("options_viewOverrides")}
          </button>
        </div>
      )}

      {/* Site Integration List */}
      <div className="options-integration-list min-w-0 flex flex-col">
        {visibleIntegrations.length === 0 ? (
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
          visibleIntegrations.map((integration) => (
            <SiteIntegrationCard
              key={integration.id}
              siteIntegration={integration}
              isEnabled={integration.enabled}
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

function IntegrationFilters({
  activeFilter,
  onFilterChange,
  counts,
}: {
  activeFilter: IntegrationFilter
  onFilterChange: (filter: IntegrationFilter) => void
  counts: Record<IntegrationFilter, number>
}) {
  const filters = [
    { value: "all", label: t("common_all") },
    { value: "enabled", label: t("common_enabled") },
    { value: "disabled", label: t("common_disabled") },
    { value: "overrides", label: t("common_overrides") },
  ] as const
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters
        .filter(
          (filter) => filter.value !== "overrides" || counts.overrides > 0
        )
        .map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
            aria-pressed={activeFilter === filter.value}
            className={cn(
              "inline-flex min-h-7 cursor-pointer items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
              activeFilter === filter.value
                ? "border border-foreground/40 bg-accent text-accent-foreground"
                : "border border-transparent bg-muted/70 text-foreground hover:bg-muted"
            )}
          >
            {filter.label} ({counts[filter.value]})
          </button>
        ))}
    </div>
  )
}
