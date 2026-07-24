/**
 * Deterministic 32×32 PNG used to exercise the Shonen Jump+ tile
 * reconstruction path in mocked E2E. Each 8×8 tile has a distinct colour.
 *
 * The encoded input is the transpose of the expected image, matching the
 * 4×4 tile transform implemented by `descrambleGigaviewerImage`. The E2E
 * spec opens the produced CBZ and verifies the decoded output tile colours.
 */

import { Buffer } from "node:buffer"

const SCRAMBLED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAgklEQVR4nO3OIQ5AUAAGYMlsKIIpNC5AUojmBIpkDqA7gGpkxQFsgugUoqIyUX5u8NdX/vD1TzmDQCBDeEPm2EG7U0IKAwwwID3gV49A1O2A2viFvHSBGGCAAfkBe84FchcGVM8mZNcRxAADDMgPfJMukMvNIK1foSaxIAYYYEB64AdVO/e5lOB+oAAAAABJRU5ErkJggg=="

export const SHONEN_JUMP_PLUS_SCRAMBLED_PNG: Buffer = Buffer.from(
  SCRAMBLED_PNG_BASE64,
  "base64"
)

export const SHONEN_JUMP_PLUS_SCRAMBLED_PNG_MIME_TYPE = "image/png"

export const SHONEN_JUMP_PLUS_EXPECTED_TILE_COLORS = [
  { x: 0, y: 0, rgba: [220, 38, 38, 255] },
  { x: 1, y: 1, rgba: [6, 182, 212, 255] },
  { x: 3, y: 3, rgba: [113, 63, 18, 255] },
] as const

export function cloneShonenJumpPlusScrambledPng(): Buffer {
  return Buffer.from(SHONEN_JUMP_PLUS_SCRAMBLED_PNG)
}
