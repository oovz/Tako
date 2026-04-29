import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import {
  generateContentScriptMatches,
  generateContentScriptExcludeMatches,
} from "./src/site-integrations/manifest";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  // Configure Vite
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./"),
      },
    },
  }),

  // Use build hook to inject content script matches from unified manifest (SSOT)
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // Generate matches from site integration manifest (SSOT)
      const matches = generateContentScriptMatches();
      const excludeMatches = generateContentScriptExcludeMatches();

      // Find and update the main content script entry by its output path
      // This avoids hardcoding domain names which would defeat SSOT
      if (!manifest.content_scripts || manifest.content_scripts.length === 0) {
        return;
      }

      for (const cs of manifest.content_scripts) {
        // Identify main content script by its js file path
        const isMainContentScript = cs.js?.some(js =>
          js.includes('content-scripts/content.js') || js === 'content-scripts/content.js'
        );
        if (isMainContentScript) {
          cs.matches = matches;
          if (excludeMatches.length > 0) {
            cs.exclude_matches = excludeMatches;
          }
        }
      }
    },
  },

  // Configure manifest
  manifest: {
    name: "Tako Manga Downloader",
    version: "1.1.1",
    description: "Save chapters from supported manga sites into organized CBZ, ZIP, or image files from Chrome's Side Panel.",
    minimum_chrome_version: "122",
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
      "declarativeNetRequest", // Required for Pixiv-only session DNR referer rewrite on img-comic.pximg.net image fetches
      "cookies"  // Required for chrome.cookies.getAll() — Pixiv Comic auth cookie forwarding
    ],
    background: {
      type: "module"
    },
    side_panel: {
      default_path: "sidepanel.html"
    },
    host_permissions: [
      "<all_urls>" // needed for cross-origin fetches; no per-host entries
    ],
    action: {
      default_title: "Tako Manga Downloader",
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
    // not accessed by web pages. Exposing to <all_urls> was unnecessary and violated least privilege.
    web_accessible_resources: [],
  },

  // Configure frontend framework
  webExt: {
    startUrls: ["https://mangadex.org/title/db692d58-4b13-4174-ae8c-30c515c0689c/hunter-x-hunter"],
    disabled: false,
  },

  // Configure dev server
  dev: {
    server: {
      port: 51730,
    },
  },
});
