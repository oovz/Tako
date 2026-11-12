import { OptionsActivityTaskIdSchema } from "@/src/runtime/runtime-message-contracts"

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

export function getLinkedActivityTaskId(search: string): string | undefined {
  if (getInitialOptionsSection(search) !== "activity") return undefined
  const taskId = OptionsActivityTaskIdSchema.safeParse(
    new URLSearchParams(search).get("task")
  )
  return taskId.success ? taskId.data : undefined
}

export function getOptionsSectionUrl(
  currentUrl: string,
  section: OptionsSection
): string {
  const url = new URL(currentUrl)
  url.searchParams.set("tab", section)
  url.searchParams.delete("task")
  return url.toString()
}
