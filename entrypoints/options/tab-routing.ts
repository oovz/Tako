export type OptionsSection =
  "general" | "storage" | "network" | "integrations" | "activity"

const SECTION_ALIASES: Record<string, OptionsSection> = {
  general: "general",
  storage: "storage",
  network: "network",
  integrations: "integrations",
  activity: "activity",
  downloads: "activity",
  debug: "network",
  global: "general",
}

export function getInitialOptionsSection(search: string): OptionsSection {
  try {
    const params = new URLSearchParams(search)
    const rawTab = params.get("tab")
    if (!rawTab) {
      return "general"
    }

    const normalized = rawTab.trim().toLowerCase()
    return SECTION_ALIASES[normalized] ?? "general"
  } catch {
    return "general"
  }
}

export function getOptionsSectionUrl(
  currentUrl: string,
  section: OptionsSection
): string {
  const url = new URL(currentUrl)
  url.searchParams.set("tab", section)
  return url.toString()
}
