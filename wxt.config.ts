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
      "https://mangamillion.shueisha.co.jp/en/title/121",
    ],
    disabled: false,
  },

  dev: {
    server: {
      port: 51730,
    },
  },
})
