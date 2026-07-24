import { rm } from "node:fs/promises"

export async function clearE2eCoverageRunOutput({
  enabled,
  outputDir,
}: {
  enabled: boolean
  outputDir: string
}): Promise<void> {
  if (!enabled) {
    return
  }

  await rm(outputDir, { recursive: true, force: true })
}
