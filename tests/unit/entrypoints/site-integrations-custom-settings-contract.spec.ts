import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-collapsible': 'mock' }, children),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

import { SiteIntegrationCard } from '@/entrypoints/options/components/SiteIntegrationCard'
import { SiteIntegrationManagementTab } from '@/entrypoints/options/tabs/SiteIntegrationManagementTab'
import { getSiteIntegrationManifestById } from '@/src/site-integrations/manifest'
import { siteIntegrationRegistry } from '@/src/runtime/site-integration-registry'
import { DEFAULT_SETTINGS } from '@/src/storage/default-settings'

describe('Site integration custom settings contract', () => {
  it('renders dynamic custom setting controls with per-setting enable toggle', () => {
    const mangadex = getSiteIntegrationManifestById('mangadex')
    expect(mangadex).toBeDefined()

    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationCard, {
        siteIntegration: {
          id: mangadex!.id,
          name: mangadex!.name,
          domains: mangadex!.patterns.domains,
          customSettings: mangadex!.customSettings,
        },
        isEnabled: true,
        override: undefined,
        globalDefaults: {
          outputFormat: 'cbz',
          imagePolicy: { concurrency: 2, delayMs: 500 },
          chapterPolicy: { concurrency: 2, delayMs: 500 },
        },
        siteIntegrationSettingsValues: {},
        onEnabledChange: vi.fn(),
        onSiteIntegrationSettingsChange: vi.fn(),
        onChange: vi.fn(),
      }),
    )

    expect(html).toContain('Custom settings')
    expect(html).toContain('Enabled')
    expect(html).toContain('Enable override')
    expect(html).toContain('Image quality')
  })

  it('renders the Site Integrations tab from manifest data before registry initialization', () => {
    siteIntegrationRegistry.clear()

    const html = renderToStaticMarkup(
      React.createElement(SiteIntegrationManagementTab, {
        overrides: {},
        siteIntegrationEnablement: {},
        globalSettings: DEFAULT_SETTINGS,
        siteIntegrationSettingsByIntegration: {},
        onSiteIntegrationSettingsChange: vi.fn(),
        onSiteIntegrationEnablementChange: vi.fn(),
        onChange: vi.fn(),
      }),
    )

    expect(html).toContain('data-testid="site-integration-card-mangadex"')
    expect(html).toContain('data-testid="site-integration-card-manhuagui"')
    expect(html).not.toContain('v1.0.0')
  })
})
