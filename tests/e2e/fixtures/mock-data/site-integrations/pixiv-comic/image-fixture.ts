import { Buffer } from "node:buffer"

// Generated 64×64 RGBA quadrants exercise a 2×2 gridshuffle transform.
// These pixels contain no captured artwork. Declared source dimensions remain in the manifest.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAc0lEQVR4nO3QMREAIBAEMdS9JkQgByUYAlxc8Sm238nYc91kFW4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHQDOHwlW4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAGAA/ZpdJ3wUMJyQAAAABJRU5ErkJggg=="

export function clonePixivPagePngBytes(): Buffer {
  return Buffer.from(PNG_BASE64, "base64")
}
