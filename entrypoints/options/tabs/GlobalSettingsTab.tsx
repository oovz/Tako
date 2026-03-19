/**
 * GlobalSettingsTab - Download-related settings only
 * Advanced/debug settings are in the About/Debug section.
 */

import React from 'react'
import type { ExtensionSettings } from "@/src/storage/settings-types"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { GlobalNotificationsSection } from '@/entrypoints/options/components/GlobalNotificationsSection'
import { GlobalPerformanceSection } from '@/entrypoints/options/components/GlobalPerformanceSection'
import { GlobalRetrySection } from '@/entrypoints/options/components/GlobalRetrySection'
import { GlobalStorageFormatSection } from '@/entrypoints/options/components/GlobalStorageFormatSection'

interface GlobalSettingsTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
}

export function GlobalSettingsTab({
  settings,
  onChange,
}: GlobalSettingsTabProps) {

  // Helper to update nested settings
  const updateDownloads = (updates: Partial<ExtensionSettings['downloads']>) => {
    onChange({ downloads: { ...settings.downloads, ...updates } })
  }

  const showNoArchiveWarning =
    settings.downloads.defaultFormat === 'none' &&
    settings.downloads.downloadMode === 'browser'

  // Update global rate limiting policies
  const updateGlobalPolicy = (scope: 'image' | 'chapter', policy: Partial<RateScopePolicy>) => {
    onChange({
      globalPolicy: {
        ...settings.globalPolicy,
        [scope]: { ...settings.globalPolicy[scope], ...policy }
      }
    })
  }

  // Update global retry counts
  const updateGlobalRetries = (updates: Partial<ExtensionSettings['globalRetries']>) => {
    onChange({ globalRetries: { ...settings.globalRetries, ...updates } })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Section 1: Storage & Formats */}
      <GlobalStorageFormatSection
        downloads={settings.downloads}
        showNoArchiveWarning={showNoArchiveWarning}
        onDownloadsChange={updateDownloads}
      />

      {/* Section 2: Performance & limits */}
      <GlobalPerformanceSection
        downloads={settings.downloads}
        imagePolicy={settings.globalPolicy.image}
        onDownloadsChange={updateDownloads}
        onImagePolicyChange={(policy) => updateGlobalPolicy('image', policy)}
      />

      {/* Section 3: Retry Settings */}
      <GlobalRetrySection
        retries={settings.globalRetries}
        onChange={updateGlobalRetries}
      />

      {/* Section 4: Notifications */}
      <GlobalNotificationsSection
        enabled={settings.notifications}
        onChange={(enabled) => onChange({ notifications: enabled })}
      />
    </div>
  )
}
