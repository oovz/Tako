const OPTIONS_SECTIONS = [
  "general",
  "storage",
  "network",
  "integrations",
  "activity",
] as const

export type OptionsSection = (typeof OPTIONS_SECTIONS)[number]

export function getInitialOptionsSection(search: string): OptionsSection {
  const section = new URLSearchParams(search).get("tab")?.trim().toLowerCase()
  return (
    OPTIONS_SECTIONS.find((candidate) => candidate === section) ?? "general"
  )
}

export function getOptionsSectionUrl(
  currentUrl: string,
  section: OptionsSection
): string {
  const url = new URL(currentUrl)
  url.searchParams.set("tab", section)
  return url.toString()
}
