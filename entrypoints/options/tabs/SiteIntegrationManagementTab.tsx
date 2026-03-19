/**
 * SiteIntegrationManagementTab - Site integration management with search and overrides
 */

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
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
        {/* Search Input */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search site integrations by name or domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Override Summary Banner */}
        {overrideCount > 0 && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4 flex items-center gap-3 text-yellow-600 dark:text-yellow-400">
            <div className="h-5 w-5 rounded-full border-2 border-current flex items-center justify-center font-bold text-[10px]">
              !
            </div>
            <p className="text-sm font-medium">
              You have active overrides for {overrideCount} {overrideCount !== 1 ? 'integrations' : 'integration'}.
            </p>
          </div>
        )}

        {/* Site Integration List */}
        <div className="min-w-0 space-y-4">
          {sortedIntegrations.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/10 border-dashed">
              <div className="text-muted-foreground">
                {search ? (
                  <>
                    <p className="font-medium">No integrations found</p>
                    <p className="text-sm mt-1">Try searching for something else</p>
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

