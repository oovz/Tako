import { spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"

export async function startFirefox(
  downloadDirectory: string,
  proxyPort: number
) {
  const driver = spawn(
    process.env.GECKODRIVER ?? "geckodriver",
    ["--allow-system-access", "--port", "0"],
    { stdio: ["ignore", "pipe", "inherit"] }
  )
  const lines = createInterface({ input: driver.stdout })
  let sessionId: string | undefined

  try {
    const port = await new Promise<string>((resolve, reject) => {
      driver.once("error", reject)
      driver.once("exit", (code) =>
        reject(new Error(`geckodriver exited: ${code}`))
      )
      lines.on("line", (line) => {
        const port = /Listening on 127\.0\.0\.1:(\d+)/.exec(line)?.[1]
        if (port) resolve(port)
      })
    })

    async function request<T>(
      method: string,
      path: string,
      body?: object
    ): Promise<T> {
      const session = sessionId ? `/${sessionId}` : ""
      const response = await fetch(
        `http://127.0.0.1:${port}/session${session}${path}`,
        {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        }
      )
      const { value } = await response.json()
      if (!response.ok) {
        throw new Error(`${method} ${path}: ${value.message}`)
      }
      return value as T
    }

    const session = await request<{
      sessionId: string
      capabilities: { browserVersion: string }
    }>("POST", "", {
      capabilities: {
        alwaysMatch: {
          browserName: "firefox",
          "moz:firefoxOptions": {
            ...(process.env.FIREFOX_BIN
              ? { binary: process.env.FIREFOX_BIN }
              : {}),
            args: ["-headless"],
            prefs: {
              "browser.download.dir": downloadDirectory,
              "browser.download.folderList": 2,
              "browser.download.useDownloadDir": true,
              "browser.download.alwaysOpenPanel": false,
              "intl.locale.requested": "en-US",
              "network.proxy.type": 1,
              "network.proxy.http": "127.0.0.1",
              "network.proxy.http_port": proxyPort,
              "network.proxy.ssl": "127.0.0.1",
              "network.proxy.ssl_port": proxyPort,
              "network.trr.mode": 5,
              "privacy.userContext.enabled": true,
            },
          },
        },
      },
    })
    sessionId = session.sessionId
    await request("POST", "/moz/context", { context: "chrome" })
    return {
      version: session.capabilities.browserVersion,
      install: (path: string) =>
        request<string>("POST", "/moz/addon/install", {
          path,
          temporary: true,
        }),
      execute: <T>(script: string, ...args: unknown[]) =>
        request<T>("POST", "/execute/sync", { script, args }),
      executeAsync: <T>(script: string, ...args: unknown[]) =>
        request<T>("POST", "/execute/async", { script, args }),
      async clickContent(selector: string) {
        // A tab opened by the extension does not change WebDriver's target.
        const handle = await request<string>("POST", "/execute/sync", {
          script: `
            const { NavigableManager } = ChromeUtils.importESModule("chrome://remote/content/shared/NavigableManager.sys.mjs");
            return NavigableManager.getIdForBrowser(gBrowser.selectedBrowser);
          `,
          args: [],
        })
        await request("POST", "/moz/context", { context: "content" })
        try {
          await request("POST", "/window", { handle })
          const element = await request<Record<string, string>>(
            "POST",
            "/element",
            { using: "css selector", value: selector }
          )
          const elementId = element["element-6066-11e4-a52e-4f735466cecf"]
          await request("POST", `/element/${elementId}/click`, {})
        } finally {
          await request("POST", "/moz/context", { context: "chrome" })
        }
      },
      async close() {
        try {
          await request("DELETE", "")
        } finally {
          await stop()
        }
      },
    }
  } catch (error) {
    await stop()
    throw error
  }

  async function stop() {
    lines.close()
    if (driver.pid && driver.exitCode === null && driver.signalCode === null) {
      const exited = once(driver, "exit")
      driver.kill()
      await exited
    }
  }
}
