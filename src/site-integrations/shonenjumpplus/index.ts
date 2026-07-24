import type { RuntimeSiteIntegration } from "@/src/types/site-integrations"
import { backgroundSiteAdapter } from "./background-runtime"
import { offscreenSiteAdapter } from "./offscreen-runtime"

export const shonenJumpPlusIntegration = {
  id: "shonenjumpplus",
  background: backgroundSiteAdapter.background,
  offscreen: offscreenSiteAdapter.offscreen,
} satisfies RuntimeSiteIntegration
