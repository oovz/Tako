export const MOTION_PREFERENCES = ["system", "reduce"] as const

export type MotionPreference = (typeof MOTION_PREFERENCES)[number]

export function isMotionPreference(value: unknown): value is MotionPreference {
  return MOTION_PREFERENCES.some((preference) => preference === value)
}
