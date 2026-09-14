import http from "node:http"
import { describe, expect, it, vi } from "vitest"
import { startLocalMockServer } from "@/tests/e2e/fixtures/local-mock-server"

describe("browser-facing mock server", () => {
  it.each(["EADDRINUSE", "EACCES"])(
    "claims a fetchable port after %s",
    async (code) => {
      const listen = http.Server.prototype.listen
      const intercepted = vi
        .spyOn(http.Server.prototype, "listen")
        .mockImplementationOnce(function (this: http.Server) {
          queueMicrotask(() =>
            this.emit(
              "error",
              Object.assign(new Error("Port unavailable"), { code })
            )
          )
          return this
        })
        .mockImplementation(function (this: http.Server, ...args: unknown[]) {
          return Reflect.apply(listen, this, args)
        })
      let server: Awaited<ReturnType<typeof startLocalMockServer>> | undefined
      try {
        server = await startLocalMockServer()
        server.addRoute("/ready", () => ({ status: 200, body: "ready" }))
        expect(await (await fetch(`${server.url}/ready`)).text()).toBe("ready")
        expect(intercepted).toHaveBeenCalledTimes(2)
      } finally {
        await server?.close()
        intercepted.mockRestore()
      }
    }
  )

  it("propagates unrelated bind failures", async () => {
    const error = Object.assign(new Error("Unexpected bind failure"), {
      code: "EINVAL",
    })
    const intercepted = vi
      .spyOn(http.Server.prototype, "listen")
      .mockImplementation(function (this: http.Server) {
        queueMicrotask(() => this.emit("error", error))
        return this
      })
    try {
      await expect(startLocalMockServer()).rejects.toBe(error)
      expect(intercepted).toHaveBeenCalledOnce()
    } finally {
      intercepted.mockRestore()
    }
  })

  it("remains fetchable when the OS would assign a browser-blocked ephemeral port", async () => {
    const listen = http.Server.prototype.listen
    const intercepted = vi
      .spyOn(http.Server.prototype, "listen")
      .mockImplementation(function (this: http.Server, ...args: unknown[]) {
        // Reproduce the observed Windows allocation: listen(0) selected 6667.
        if (args[0] === 0) args[0] = 6667
        return Reflect.apply(listen, this, args)
      })
    let server: Awaited<ReturnType<typeof startLocalMockServer>> | undefined
    try {
      server = await startLocalMockServer()
      server.addRoute("/ready", () => ({ status: 200, body: { ready: true } }))
      const response = await fetch(`${server.url}/ready`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ready: true })
    } finally {
      await server?.close()
      intercepted.mockRestore()
    }
  })
})
