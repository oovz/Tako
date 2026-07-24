import type {
  BackgroundIntegration,
  RuntimeSiteIntegration,
} from "../../types/site-integrations"
import { backgroundSiteAdapter } from "./background-runtime"
import { offscreenSiteAdapter } from "./offscreen-runtime"

export const pixivComicBackgroundIntegration: BackgroundIntegration = {
  ...backgroundSiteAdapter.background,
  chapter: offscreenSiteAdapter.offscreen.chapter,
}

export const pixivComicIntegration = {
  id: "pixiv-comic",
  background: pixivComicBackgroundIntegration,
  offscreen: offscreenSiteAdapter.offscreen,
} satisfies RuntimeSiteIntegration
