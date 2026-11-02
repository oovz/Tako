import type { ManganatoSite } from "../reader/protocol"

export const MANGANATO_SITE = {
  id: "manganato",
  name: "MangaNato",
  domain: "manganato.gg",
} as const satisfies ManganatoSite
