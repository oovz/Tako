/** Structural comparison shared by draft merging and exact own-save matching. */
export function isOptionsRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => optionsValuesEqual(entry, right[index]))
  )
}

function recordsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left)
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && optionsValuesEqual(left[key], right[key])
    )
  )
}

export function optionsValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return arraysEqual(left, right)
  if (!isOptionsRecord(left) || !isOptionsRecord(right)) return false
  return recordsEqual(left, right)
}
