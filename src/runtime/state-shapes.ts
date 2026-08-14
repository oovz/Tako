import type { ChapterState, MangaPageState } from "@/src/types/tab-state"

export function deriveVolumeStates(
  chapters: Array<Pick<ChapterState, "volumeNumber" | "volumeLabel" | "index">>
): MangaPageState["volumes"] {
  const volumeMap = new Map<number, { label?: string; firstIndex: number }>()

  for (const chapter of chapters) {
    if (
      typeof chapter.volumeNumber !== "number" ||
      Number.isNaN(chapter.volumeNumber)
    ) {
      continue
    }

    const existing = volumeMap.get(chapter.volumeNumber)
    const label =
      typeof chapter.volumeLabel === "string" &&
      chapter.volumeLabel.trim().length > 0
        ? chapter.volumeLabel.trim()
        : `Volume ${chapter.volumeNumber}`

    if (!existing) {
      volumeMap.set(chapter.volumeNumber, {
        label,
        firstIndex:
          typeof chapter.index === "number"
            ? chapter.index
            : Number.MAX_SAFE_INTEGER,
      })
      continue
    }

    if (!existing.label && label) {
      existing.label = label
    }

    if (
      typeof chapter.index === "number" &&
      chapter.index < existing.firstIndex
    ) {
      existing.firstIndex = chapter.index
    }
  }

  return Array.from(volumeMap.entries())
    .sort(([leftVolumeNumber, left], [rightVolumeNumber, right]) => {
      if (leftVolumeNumber !== rightVolumeNumber) {
        return leftVolumeNumber - rightVolumeNumber
      }

      return left.firstIndex - right.firstIndex
    })
    .map(([volumeNumber, value]) => ({
      id: `volume-${volumeNumber}`,
      title: value.label,
      label: value.label,
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
