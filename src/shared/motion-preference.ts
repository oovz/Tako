export const MOTION_PREFERENCES = ["system", "reduce"] as const

export type MotionPreference = (typeof MOTION_PREFERENCES)[number]
