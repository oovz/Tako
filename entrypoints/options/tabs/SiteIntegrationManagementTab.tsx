/**
 * SiteIntegrationManagementTab - Site integration management with search and overrides
 */

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search } from "lucide-react"
import { SiteIntegrationCard } from "../components/SiteIntegrationCard"
import { siteIntegrationRegistry } from "@/src/runtime/site-integration-registry"
import { getAllPatternMetadata } from "@/src/site-integrations/url-matcher"
import type { SiteOverrideRecord } from "@/src/storage/site-overrides-service"
import type { SiteIntegrationEnablementMap } from "@/src/storage/site-integration-enablement-service"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { SiteIntegrationSettingValue } from "@/src/storage/site-integration-settings-service"

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

  // Build site integration list from registry
  const integrations = useMemo(() => {
    const allIntegrations = siteIntegrationRegistry.getAll()
    const patterns = getAllPatternMetadata()

    return allIntegrations
      .filter(si => patterns.some(p => p.integrationId === si.id && !p.domains.some(d => d.includes('nosupport.tld'))))
      .map(si => {
        const pattern = patterns.find(p => p.integrationId === si.id)
        return {
          id: si.id,
          name: si.name,
          domains: pattern?.domains || [],
          version: si.version,
          customSettings: si.customSettings,
          policyDefaults: si.policyDefaults
        }
      })
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
      <div className="min-w-0 space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-foreground">Site Integrations</h2>
            <Badge variant="secondary" className="h-5 px-2 text-[10px] font-medium text-muted-foreground">
              {sortedIntegrations.length}
              {' integrations'}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Tune site-specific defaults, custom settings, and enablement without touching the global download profile.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search site integrations by name or domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 border-border/70 bg-background pl-9 text-sm"
          />
        </div>

        {/* Override Summary Banner */}
        {overrideCount > 0 && (
          <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
            <Badge variant="outline" className="mr-2 border-yellow-500/40 bg-transparent text-[10px] font-medium text-current">
              Overrides
            </Badge>
            You have active overrides for {overrideCount} {overrideCount !== 1 ? 'integrations' : 'integration'}.
          </div>
        )}

        {/* Site Integration List */}
        <div className="min-w-0 space-y-4">
          {sortedIntegrations.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/80 bg-muted/10 py-12 text-center">
              <div className="text-muted-foreground">
                {search ? (
                  <>
                    <p className="font-medium text-foreground">No integrations found</p>
                    <p className="mt-1 text-sm">Try searching for something else</p>
                  </>
                ) : (
                  <p>No integrations available</p>
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

