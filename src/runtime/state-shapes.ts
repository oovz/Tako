import type { ChapterState, MangaPageState } from "@/src/types/tab-state"

export function deriveVolumeStates(
  chapters: Array<Pick<ChapterState, "volumeNumber" | "volumeLabel" | "index">>
): MangaPageState["volumes"] {
  const volumeMap = new Map<number, string>()

  for (const chapter of chapters) {
    if (
      typeof chapter.volumeNumber !== "number" ||
      Number.isNaN(chapter.volumeNumber) ||
      volumeMap.has(chapter.volumeNumber)
    ) {
      continue
    }
    const label =
      typeof chapter.volumeLabel === "string" && chapter.volumeLabel.trim()
        ? chapter.volumeLabel.trim()
        : `Volume ${chapter.volumeNumber}`
    volumeMap.set(chapter.volumeNumber, label)
  }

  return Array.from(volumeMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([volumeNumber, label]) => ({
      id: `volume-${volumeNumber}`,
      title: label,
      label,
    }))
}

export function resolveVolumeStates(
  chapters: Array<Pick<ChapterState, "volumeNumber" | "volumeLabel" | "index">>,
  volumes?: MangaPageState["volumes"]
): MangaPageState["volumes"] {
  if (Array.isArray(volumes) && volumes.length > 0) {
    return volumes
  }

  return deriveVolumeStates(chapters)
}
