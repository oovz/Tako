import { defineConfig } from "wxt"
import {
  createExtensionManifest,
  createViteBuildPolicy,
} from "./scripts/wxt-build-policy"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  vite: createViteBuildPolicy,

  // Test builds pre-grant provider origins; production requests optional access.
  manifest: createExtensionManifest,

  webExt: {
    startUrls: [
      "https://mangadex.org/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter",
    ],
    disabled: false,
  },

  dev: {
    server: {
      port: 51730,
    },
  },
})
