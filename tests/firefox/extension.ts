import { expect, test as base } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import packageJson from "../../package.json" with { type: "json" }
import {
  mangaMillionSeries,
  startMangaMillionFixture,
} from "./mangamillion-fixture"
import { startFirefox } from "./webdriver"

type Firefox = Awaited<ReturnType<typeof startFirefox>>
type Network = Awaited<ReturnType<typeof startMangaMillionFixture>>
type Download = {
  path: string
  filename: string
  stopped: boolean
  succeeded: boolean
  canceled: boolean
}

export const test = base.extend<{
  extension: ReturnType<typeof browserActions> & {
    downloadsDirectory: string
    relativeDownloadPath: (path: string) => string
    fixture: Network
    firefox: Firefox
  }
}>({
  // eslint-disable-next-line no-empty-pattern
  async extension({}, use, testInfo) {
    const downloadsDirectory = testInfo.outputPath("Downloads")
    await mkdir(downloadsDirectory, { recursive: true })
    const fixture = await startMangaMillionFixture(testInfo.outputDir)
    try {
      const firefox = await startFirefox(downloadsDirectory, fixture.port)
      try {
        testInfo.annotations.push({
          type: "Firefox",
          description: firefox.version,
        })
        await firefox.execute(
          `Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB)
              .addCertFromBase64(arguments[0], "CT,,");`,
          fixture.certificate
        )
        const extensionId = await firefox.install(
          resolve(
            ".output",
            `tako-manga-downloader-${packageJson.version}-firefox.zip`
          )
        )
        const actions = browserActions(firefox, extensionId)
        await actions.pinToolbarAction()
        await actions.navigate(mangaMillionSeries)
        await use({
          ...actions,
          firefox,
          fixture,
          downloadsDirectory,
          relativeDownloadPath: (path) =>
            relative(downloadsDirectory, path).split(sep).join("/"),
        })
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("Firefox sidebar", {
            body: await actions.sidebarText().catch(String),
            contentType: "text/plain",
          })
        }
      } finally {
        await firefox.close()
      }
    } finally {
      await fixture.close()
    }
  },
})

export { expect }

function browserActions(firefox: Firefox, extensionId: string) {
  async function activePage<T>(script: string): Promise<T> {
    const result = await firefox.executeAsync<{ value: T } | { error: string }>(
      `
      const [script, done] = arguments;
      const actor = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("MarionetteCommands");
      actor.executeScript(script, [], {}).then(value => done({ value }), error => done({ error: String(error) }));
    `,
      script
    )
    if ("error" in result) throw new Error(result.error)
    return result.value
  }

  async function sidebar<T>(script: string): Promise<T> {
    const result = await firefox.executeAsync<{ value: T } | { error: string }>(
      `
      const [script, done] = arguments;
      const panel = document.getElementById("sidebar")
        ?.contentDocument?.getElementById("webext-panels-browser");
      const actor = panel?.browsingContext?.currentWindowGlobal?.getActor("MarionetteCommands");
      if (!actor) return done({ error: "The Tako sidebar is closed or still loading" });
      actor.executeScript(script, [], {}).then(value => done({ value }), error => done({ error: String(error) }));
    `,
      script
    )
    if ("error" in result) throw new Error(result.error)
    return result.value
  }

  async function clickSidebar(selector: string) {
    await expect
      .poll(() =>
        sidebar<boolean>(`
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || element.closest("[hidden]")) return false;
      element.click();
      return true;
    `).catch(() => false)
      )
      .toBe(true)
  }

  return {
    activePage,
    sidebar,
    clickSidebar,
    sidebarText: () => sidebar<string>("return document.body?.innerText || ''"),
    async pinToolbarAction() {
      await firefox.execute(
        `
        const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
        const widget = arguments[0].toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";
        CustomizableUI.addWidgetToArea(widget, CustomizableUI.AREA_NAVBAR);
      `,
        extensionId
      )
    },
    async openSidebar() {
      await firefox.execute(
        `
        const button = document.querySelector(".unified-extensions-item-action-button[data-extensionid='" + arguments[0] + "']");
        if (!button) throw new Error("Extension toolbar action is missing");
        const input = window.windowUtils.setHandlingUserInput(true);
        try { button.click(); } finally { input.destruct(); }
      `,
        extensionId
      )
      await expect
        .poll(() =>
          sidebar<boolean>(
            "return !!document.querySelector('[role=tablist]')"
          ).catch(() => false)
        )
        .toBe(true)
    },
    closeSidebar: () => firefox.execute("SidebarController.hide()"),
    async navigate(url: string, newTab?: "default" | "container") {
      await firefox.execute(
        `
        const [url, newTab] = arguments;
        const triggeringPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
        if (newTab) {
          gBrowser.selectedTab = gBrowser.addTab(url, { userContextId: newTab === "container" ? 1 : 0, triggeringPrincipal });
        } else {
          gBrowser.loadURI(Services.io.newURI(url), { triggeringPrincipal });
        }
      `,
        url,
        newTab ?? null
      )
      await expect
        .poll(() => firefox.execute("return gBrowser.currentURI.spec"))
        .toBe(url)
    },
    async selectManga() {
      await clickSidebar("#panel-tab-manga")
    },
    async queueFirstChapter(chapterTitle: string) {
      await clickSidebar(
        `[role=checkbox][aria-label*=${JSON.stringify(chapterTitle)}]`
      )
      await clickSidebar('button[aria-label="Download (1)"]')
    },
    browserDownloads: () =>
      firefox.executeAsync<Download[]>(`
      const done = arguments[0];
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      Downloads.getList(Downloads.PUBLIC).then(list => list.getAll()).then(items =>
        done(items.map(({target, stopped, succeeded, canceled}) => ({
          path: target.path, filename: PathUtils.filename(target.path), stopped, succeeded, canceled
        })))
      );
    `),
    async setOutput(
      format: "cbz" | "zip" | "none",
      folder: string,
      filename: string
    ) {
      await firefox.execute(
        `
        const policy = WebExtensionPolicy.getByID(arguments[0]);
        const uri = "moz-extension://" + policy.mozExtensionHostname + "/options.html?tab=storage";
        const triggeringPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
        gBrowser.selectedTab = gBrowser.addTab(uri, { triggeringPrincipal });
      `,
        extensionId
      )
      try {
        await expect
          .poll(() =>
            activePage<boolean>(
              "return !!document.querySelector('#download-path') && document.body.innerText.includes('Firefox Downloads')"
            ).catch(() => false)
          )
          .toBe(true)
        await activePage(`
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          for (const [selector, value] of ${JSON.stringify([
            ["#download-path", folder],
            ["#filename-template", filename],
          ])}) {
            const input = document.querySelector(selector);
            set.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          document.querySelector("#format-${format}").click();
        `)
        const findSave =
          '[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Save Changes")'
        await expect
          .poll(() =>
            activePage<boolean>(`
          const save = ${findSave};
          if (!save || save.disabled) return false;
          save.click();
          return true;
        `)
          )
          .toBe(true)
        await expect
          .poll(() => activePage<boolean>(`return !(${findSave})`))
          .toBe(true)
      } finally {
        await firefox.execute("gBrowser.removeTab(gBrowser.selectedTab)")
      }
    },
    async holdBrowserTransfer(filename: string) {
      await firefox.execute(
        `
        const { DownloadIntegration } = ChromeUtils.importESModule("resource://gre/modules/DownloadIntegration.sys.mjs");
        const original = DownloadIntegration.shouldBlockForParentalControls;
        const gate = Promise.withResolvers();
        const filename = arguments[0];
        window.takoAllowedTransfer = function () {
          DownloadIntegration.shouldBlockForParentalControls = original;
          gate.resolve();
        };
        DownloadIntegration.shouldBlockForParentalControls = async function (download) {
          if (PathUtils.filename(download.target.path) === filename) await gate.promise;
          return original.call(this, download);
        };
      `,
        filename
      )
      return () => firefox.execute("window.takoAllowedTransfer()")
    },
    async cancelBrowserTransfer(filename: string) {
      return await firefox.executeAsync<boolean>(
        `
        const [filename, done] = arguments;
        const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
        Downloads.getList(Downloads.PUBLIC).then(list => list.getAll()).then(items => {
          const item = items.find(item => PathUtils.filename(item.target.path) === filename && !item.stopped);
          if (item) void item.cancel();
          done(!!item);
        });
      `,
        filename
      )
    },
  }
}
