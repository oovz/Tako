export type OptionsSection = 'global' | 'integrations' | 'downloads' | 'debug'

const SECTION_ALIASES: Record<string, OptionsSection> = {
  global: 'global',
  integrations: 'integrations',
  downloads: 'downloads',
  debug: 'debug',
}

export function getInitialOptionsSection(search: string): OptionsSection {
  try {
    const params = new URLSearchParams(search)
    const rawTab = params.get('tab')
    if (!rawTab) {
      return 'global'
    }

    const normalized = rawTab.trim().toLowerCase()
    return SECTION_ALIASES[normalized] ?? 'global'
  } catch {
    return 'global'
  }
}
