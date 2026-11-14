import { chromium, expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveBackgroundWorker } from "./fixtures/extension"
import { startLocalMockServer } from "./fixtures/local-mock-server"
import { getSessionState, getTabId } from "./fixtures/state-helpers"
import { ComicNettai, MangaMillion, PixivComic } from "./fixtures/mock-data"
import {
  COMICNETTAI_LOCAL_SITE_PREFIX,
  registerComicNettaiLocalServerHandlers,
} from "./fixtures/mock-data/site-integrations/comictropics/local-server"
import {
  MANGAMILLION_LOCAL_API_PREFIX,
  MANGAMILLION_LOCAL_SITE_PREFIX,
  registerMangaMillionLocalServerHandlers,
} from "./fixtures/mock-data/site-integrations/mangamillion/local-server"
import {
  PIXIV_COMIC_LOCAL_IMAGE_PREFIX,
  PIXIV_COMIC_LOCAL_SITE_PREFIX,
  registerPixivComicLocalServerHandlers,
} from "./fixtures/mock-data/site-integrations/pixiv-comic/local-server"
import { mangaplusFixture } from "./fixtures/mock-data/site-integrations/mangaplus/routes"
import type { ActiveTabContextByWindow } from "@/src/types/tab-state"

const providers = [
  {
    name: "COMIC nettai",
    url: "https://www.comicnettai.com/book/9",
    catalogHost: "www.comicnettai.com",
    title: ComicNettai.BASIC_SERIES.series.seriesTitle,
  },
  {
    name: "MANGA MILLION",
    url: "https://mangamillion.shueisha.co.jp/en/title/1",
    catalogHost: "api.mangamillion.shueisha.co.jp",
    title: MangaMillion.BASIC_SERIES.series.seriesTitle,
  },
  {
    name: "pixiv COMIC",
    url: `https://comic.pixiv.net/works/${PixivComic.BASIC_SERIES.series.seriesId}`,
    catalogHost: "comic.pixiv.net",
    title: PixivComic.BASIC_SERIES.series.seriesTitle,
  },
  {
    name: "MANGA Plus",
    url: mangaplusFixture.testCase.seriesUrl,
    catalogHost: "jumpg-webapi.tokyo-cdn.com",
    title: mangaplusFixture.testCase.title,
  },
]

const routePrefixes = {
  "www.comicnettai.com": COMICNETTAI_LOCAL_SITE_PREFIX,
  "mangamillion.shueisha.co.jp": MANGAMILLION_LOCAL_SITE_PREFIX,
  "api.mangamillion.shueisha.co.jp": MANGAMILLION_LOCAL_API_PREFIX,
  "comic.pixiv.net": PIXIV_COMIC_LOCAL_SITE_PREFIX,
  "img-comic.pximg.net": PIXIV_COMIC_LOCAL_IMAGE_PREFIX,
  "mangaplus.shueisha.co.jp": "/__expanded/mangaplus/0",
  "jumpg-webapi.tokyo-cdn.com": "/__expanded/mangaplus/1",
}

type ExtensionSettingsApi = {
  developerPrivate: {
    updateExtensionConfiguration: (input: {
      extensionId: string
      hostAccess: "ON_CLICK" | "ON_ALL_SITES"
    }) => Promise<void>
    addHostPermission: (extensionId: string, origin: string) => Promise<void>
  }
}

test("production host grants control chapter loading and recovery", async ({
  headless,
}) => {
  test.setTimeout(90_000)
  const workdir = await mkdtemp(path.join(tmpdir(), "tako-host-access-"))
  try {
    const keyPath = path.join(workdir, "key.pem")
    const certPath = path.join(workdir, "cert.pem")
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=Tako browser test fixture",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "pipe" }
    )
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certPath),
    ])
    const publicKey = new X509Certificate(cert).publicKey.export({
      type: "spki",
      format: "der",
    })
    const fingerprint = createHash("sha256").update(publicKey).digest("base64")
    const requests: {
      host: string
      method: string
      referer?: string
      extension: boolean
    }[] = []
    const server = await startLocalMockServer({
      tls: { key, cert },
      routePrefixes,
      onRequest: (request) =>
        requests.push({
          host: request.headers.host ?? "",
          method: request.method ?? "",
          referer: request.headers.referer,
          extension:
            request.headers["sec-fetch-mode"] !== "navigate" &&
            (request.headers.origin?.startsWith("chrome-extension://") ===
              true ||
              request.headers["sec-fetch-dest"] === "empty"),
        }),
    })
    try {
      registerComicNettaiLocalServerHandlers(server)
      registerMangaMillionLocalServerHandlers(server)
      registerPixivComicLocalServerHandlers(server)
      mangaplusFixture.registerLocalServerHandlers(server)
      const extensionPath = path.resolve(".output/chrome-mv3")
      const browser = await chromium.launchPersistentContext(
        path.join(workdir, "profile"),
        {
          channel: "chromium",
          headless,
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            `--ignore-certificate-errors-spki-list=${fingerprint}`,
            "--no-proxy-server",
            `--host-resolver-rules=${Object.keys(routePrefixes)
              .map((host) => `MAP ${host} 127.0.0.1:${server.port}`)
              .join(", ")}, MAP * ~NOTFOUND`,
          ],
        }
      )
      try {
        const worker = await resolveBackgroundWorker(browser)
        const manifest = await worker.evaluate(() =>
          chrome.runtime.getManifest()
        )
        expect(manifest.host_permissions).not.toContain("https://*/*")
        expect(manifest.optional_host_permissions).toContain("https://*/*")
        const extensionId = new URL(worker.url()).hostname
        const settings = browser.pages()[0]
        await settings.goto(`chrome://extensions/?id=${extensionId}`)
        const setAccess = (hostAccess: "ON_CLICK" | "ON_ALL_SITES") =>
          settings.evaluate(
            async ({ extensionId, hostAccess }) => {
              const { developerPrivate } =
                chrome as unknown as ExtensionSettingsApi
              await developerPrivate.updateExtensionConfiguration({
                extensionId,
                hostAccess,
              })
            },
            { extensionId, hostAccess }
          )
        const ruleInstalled = () =>
          worker.evaluate(async () =>
            (await chrome.declarativeNetRequest.getSessionRules()).some(
              (rule) => rule.id === 41001
            )
          )
        await expect.poll(ruleInstalled).toBe(true)
        await setAccess("ON_CLICK")
        await expect.poll(ruleInstalled).toBe(false)

        for (const provider of providers) {
          await test.step(provider.name, async () => {
            const catalogOrigin = `https://${provider.catalogHost}/*`
            const hasCatalogAccess = () =>
              worker.evaluate(
                (origin) => chrome.permissions.contains({ origins: [origin] }),
                catalogOrigin
              )
            await expect.poll(hasCatalogAccess).toBe(false)

            // Grant the page origin for API-backed providers. A grant for the
            // visible tab does not confer access to a separate API host.
            const pageOrigin = `${new URL(provider.url).origin}/*`
            const grant = (origin: string) =>
              settings.evaluate(
                ({ id, origin }) =>
                  (
                    chrome as unknown as ExtensionSettingsApi
                  ).developerPrivate.addHostPermission(id, origin),
                { id: extensionId, origin }
              )
            if (pageOrigin !== catalogOrigin) await grant(pageOrigin)
            const page = await browser.newPage()
            try {
              const start = requests.length
              await page.goto(provider.url, { waitUntil: "domcontentloaded" })
              const tabId = await getTabId(page, browser)
              const projection = () =>
                getSessionState<ActiveTabContextByWindow>(
                  browser,
                  "activeTabContextByWindow"
                ).then(
                  (windows) =>
                    Object.values(windows ?? {}).find(
                      (row) => row.activeTabId === tabId
                    )?.context
                )
              await expect.poll(projection).toMatchObject({
                sourceUrl: provider.url,
                reason: "host_permission_required",
                hostPermissionHostname: provider.catalogHost,
              })
              expect(
                requests
                  .slice(start)
                  .filter(
                    (request) =>
                      request.host === provider.catalogHost && request.extension
                  )
              ).toEqual([])

              await grant(catalogOrigin)
              await expect.poll(hasCatalogAccess).toBe(true)
              await page.goto("about:blank")
              await page.goto(provider.url, { waitUntil: "domcontentloaded" })
              await expect.poll(projection, { timeout: 20_000 }).toMatchObject({
                sourceUrl: provider.url,
                seriesTitle: provider.title,
                chapters: expect.arrayContaining([
                  expect.objectContaining({ id: expect.any(String) }),
                ]),
              })
              expect(
                requests
                  .slice(start)
                  .some(
                    (request) =>
                      request.host === provider.catalogHost &&
                      request.extension &&
                      request.method !== "OPTIONS"
                  )
              ).toBe(true)
            } finally {
              await page.close()
            }
          })
        }
        await setAccess("ON_ALL_SITES")
        await expect.poll(ruleInstalled).toBe(true)
        expect(
          await worker.evaluate(async () => {
            const response = await fetch("https://img-comic.pximg.net/page.png")
            await response.body?.cancel()
            return response.ok
          })
        ).toBe(true)
        expect(
          requests.find((request) => request.host === "img-comic.pximg.net")
            ?.referer
        ).toBe("https://comic.pixiv.net/")
      } finally {
        await browser.close()
      }
    } finally {
      await server.close()
    }
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
})
