import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import istanbul from "vite-plugin-istanbul"
import { siteIntegrationWxtPermissions } from "./src/runtime/generated/site-integration-wxt-permissions"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  // Configure Vite
  vite: (configEnv) => ({
    define: {
      __TAKO_E2E_STATE_SEED__: JSON.stringify(
        configEnv.mode === "live-test" ||
          (configEnv.mode === "e2e-test" &&
            process.env.TAKO_E2E_STATE_SEED === "true")
      ),
      __TAKO_E2E_REDIRECTS__: JSON.stringify(
        configEnv.mode === "e2e-test" &&
          process.env.TAKO_E2E_STATE_SEED === "true"
      ),
    },
    plugins: [
      tailwindcss(),
      // Instrument extension source for Istanbul-based E2E coverage.
      // Only active when building for coverage (E2E_COVERAGE=true) to keep
      // production and normal dev builds clean and fast.
      ...(configEnv.mode === "e2e-test" && process.env.E2E_COVERAGE === "true"
        ? [
            istanbul({
              include: ["src/**/*", "entrypoints/**/*", "components/**/*"],
              exclude: [
                "node_modules",
                ".output",
                "tests",
                "**/*.d.ts",
                "src/types/**",
                "src/runtime/generated/**",
              ],
              extension: [".js", ".ts", ".tsx"],
              requireEnv: false,
              forceBuildInstrument: true,
            }),
          ]
        : []),
    ],
    build: {
      // Vite's modulepreload helper touches document/window. Extension service
      // workers have neither, and background runtimes are lazy-loaded there.
      modulePreload: false,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./"),
      },
    },
  }),

  // Configure manifest. Isolated Playwright builds pre-grant the optional
  // wildcard permission so mocked and live MangaDex workflows can exercise the
  // enabled integration. Production keeps the user-gesture permission flow.
  manifest: ({ mode }) => {
    const isLiveTest = mode === "live-test"
    // A test environment variable alone must never make a normal production
    // artifact more permissive. Test state seeding and broad mock-host access
    // are compile-time capabilities of the isolated E2E artifacts.
    const isDeterministicE2e =
      mode === "e2e-test" && process.env.TAKO_E2E_STATE_SEED === "true"
    const grantsBroadHttpsForIsolatedTest = isLiveTest || isDeterministicE2e

    return {
      name: "__MSG_extName__",
      description: "__MSG_extDescription__",
      default_locale: "en",
      minimum_chrome_version: "150",
      permissions: [
        "storage",
        "unlimitedStorage",
        "downloads",
        "offscreen",
        "sidePanel",
        "scripting",
        "tabs",
        "webNavigation",
        "notifications",
        "alarms",
        // Use the host-access-bound DNR permission and avoid the broad
        // "Block content on any page" warning. Tako additionally scopes every
        // provider rule by target domain and extension initiator.
        "declarativeNetRequestWithHostAccess",
      ],
      background: {
        type: "module",
      },
      side_panel: {
        default_path: "sidepanel.html",
      },
      host_permissions: grantsBroadHttpsForIsolatedTest
        ? [
            ...siteIntegrationWxtPermissions.requiredOrigins,
            ...siteIntegrationWxtPermissions.optionalOrigins,
          ]
        : [...siteIntegrationWxtPermissions.requiredOrigins],
      optional_host_permissions: grantsBroadHttpsForIsolatedTest
        ? []
        : [...siteIntegrationWxtPermissions.optionalOrigins],
      action: {
        default_title: "__MSG_extName__",
        default_icon: {
          "16": "icon/16.png",
          "32": "icon/32.png",
          "48": "icon/48.png",
          "96": "icon/96.png",
          "128": "icon/128.png",
        },
      },
      icons: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "96": "icon/96.png",
        "128": "icon/128.png",
      },
      // offscreen.html removed from web_accessible_resources (2026-02-06):
      // Offscreen docs are loaded internally via chrome.offscreen.createDocument(),
      // not accessed by web pages.
      web_accessible_resources: [],
    }
  },

  // Configure frontend framework
  webExt: {
    startUrls: [
      "https://mangadex.org/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter",
    ],
    disabled: false,
  },

  // Configure dev server
  dev: {
    server: {
      port: 51730,
    },
  },
  hooks: {
    "prepare:tsconfig": (_, { tsconfig }) => {
      if (tsconfig.compilerOptions) {
        tsconfig.compilerOptions.noUncheckedIndexedAccess = false
        tsconfig.compilerOptions.noImplicitOverride = false
        tsconfig.compilerOptions.verbatimModuleSyntax = false
      }
    },
  },
})
