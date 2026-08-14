/**
 * Side-effect-free Manhuagui network policy shared by the manifest, runtime
 * URL validation, and deterministic fixtures.
 */
export const MANHUAGUI_BASE_URL = "https://www.manhuagui.com"

export const MANHUAGUI_PAGE_HOST_NAMES = [
  "www.manhuagui.com",
  "manhuagui.com",
] as const

export const MANHUAGUI_CONFIG_HOST = "cf.mhgui.com"

export const MANHUAGUI_IMAGE_HOST_NAMES = [
  "i.hamreus.com",
  "eu.hamreus.com",
  "eu1.hamreus.com",
  "eu2.hamreus.com",
  "us.hamreus.com",
  "us1.hamreus.com",
  "us2.hamreus.com",
  "us3.hamreus.com",
] as const

export const MANHUAGUI_IMAGE_REFERER = "https://www.manhuagui.com/"

export const MANHUAGUI_CREDENTIAL_POLICY = {
  pageHtml: "include",
  configuration: "omit",
  image: "omit",
} as const satisfies Record<
  "pageHtml" | "configuration" | "image",
  "include" | "omit"
>
