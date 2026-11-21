import process from "node:process"
import type { ConfigEnv, UserManifest, WxtViteConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"
import { siteIntegrationWxtPermissions } from "../src/runtime/generated/site-integration-wxt-permissions"
import { MANGADEX_REPORTING_DATA_TYPE } from "../src/site-integrations/mangadex/report-permission"

export function createViteBuildPolicy(configEnv: ConfigEnv): WxtViteConfig {
  return {
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
    plugins: [tailwindcss()],
    build: {
      // Vite's modulepreload helper touches document/window. Extension service
      // workers have neither, and background runtimes are lazy-loaded there.
      modulePreload: false,
    },
  }
}

export function createExtensionManifest({
  browser,
  mode,
}: ConfigEnv): UserManifest {
  const firefox = browser === "firefox"
  const isLiveTest = mode === "live-test"
  // Test capabilities require an isolated build mode.
  const isDeterministicE2e =
    mode === "e2e-test" && process.env.TAKO_E2E_STATE_SEED === "true"
  const grantsBroadHttpsForIsolatedTest = isLiveTest || isDeterministicE2e

  return {
    name: "__MSG_extName__",
    description: firefox
      ? "__MSG_extDescriptionFirefox__"
      : "__MSG_extDescription__",
    default_locale: "en",
    ...(firefox
      ? {
          incognito: "not_allowed" as const,
          browser_specific_settings: {
            gecko: {
              id: "tako-manga-downloader@oovz",
              strict_min_version: "153.0",
              data_collection_permissions: {
                required: ["none" as const],
                optional: [MANGADEX_REPORTING_DATA_TYPE],
              },
            },
          },
        }
      : { minimum_chrome_version: "150" }),
    permissions: [
      "storage",
      "unlimitedStorage",
      "downloads",
      ...(firefox ? [] : ["offscreen", "sidePanel"]),
      "scripting",
      "tabs",
      "webNavigation",
      "notifications",
      "alarms",
      // Provider rules are scoped to declared hosts and extension requests.
      "declarativeNetRequestWithHostAccess",
    ],
    background: {
      type: "module",
    },
    host_permissions: grantsBroadHttpsForIsolatedTest
      ? [
          ...siteIntegrationWxtPermissions.requiredOrigins,
          ...siteIntegrationWxtPermissions.optionalOrigins,
          ...(isDeterministicE2e ? ["http://127.0.0.1/*"] : []),
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
    // Extension documents are loaded internally.
    web_accessible_resources: [],
  }
}
