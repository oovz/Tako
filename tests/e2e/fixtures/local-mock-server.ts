/**
 * Serve DNR-redirected fixture requests, including offscreen fetches that
 * Playwright routes do not reliably intercept. The longest matching path
 * prefix selects the handler.
 */

import http from "node:http"
import https from "node:https"
import { randomInt } from "node:crypto"
import { redactDiagnostic } from "../../../src/runtime/diagnostic-redaction"
import type { AddressInfo } from "node:net"

/**
 * Response payload returned by a `MockRouteHandler`.
 *
 * `body` may be a `Buffer`, `string`, or arbitrary object (objects are
 * JSON-stringified with `application/json; charset=utf-8` unless the
 * handler sets a `content-type` header itself).
 */
export interface MockRouteResponse {
  status: number
  headers?: Record<string, string>
  body: Buffer | string | Uint8Array | object
}

/** Route handlers receive the path after their matched prefix. */
export interface MockRouteRequest {
  method: string
  url: URL
  pathnameAfterPrefix: string
  body: Buffer
  headers: http.IncomingHttpHeaders
}

export type MockRouteHandler = (
  req: MockRouteRequest
) => Promise<MockRouteResponse | null> | MockRouteResponse | null

export interface LocalMockServerHandle {
  /** Port the server is listening on (127.0.0.1 only). */
  readonly port: number
  /** Full base URL, e.g. `http://127.0.0.1:49152`. */
  readonly url: string
  /**
   * Register a handler for a pathname prefix. Prefixes SHOULD start with
   * `/` (e.g. `/manhuagui`). Returning `null` from the handler yields a
   * 404. Later-registered prefixes override earlier ones for the same
   * exact string, but overlapping prefixes are matched longest-first.
   */
  readonly addRoute: (prefix: string, handler: MockRouteHandler) => void
  /** Tear down the server; safe to call multiple times. */
  readonly close: () => Promise<void>
}

function toResponseBuffer(body: MockRouteResponse["body"]): {
  buffer: Buffer
  contentType?: string
} {
  if (Buffer.isBuffer(body)) return { buffer: body }
  if (body instanceof Uint8Array) return { buffer: Buffer.from(body) }
  if (typeof body === "string") return { buffer: Buffer.from(body, "utf8") }
  return {
    buffer: Buffer.from(JSON.stringify(body), "utf8"),
    contentType: "application/json; charset=utf-8",
  }
}

function pickHandler(
  routes: Map<string, MockRouteHandler>,
  pathname: string
): { prefix: string; handler: MockRouteHandler } | undefined {
  let best: { prefix: string; handler: MockRouteHandler } | undefined
  for (const [prefix, handler] of routes) {
    if (
      pathname === prefix ||
      pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
    ) {
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, handler }
      }
    }
  }
  return best
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function startLocalMockServer(productionOrigins?: {
  tls: https.ServerOptions
  routePrefixes: Readonly<Record<string, string>>
  onRequest: (request: http.IncomingMessage) => void
}): Promise<LocalMockServerHandle> {
  const routes = new Map<string, MockRouteHandler>()

  /**
   * Credentialed requests need the exact Origin, including a redirected `null`
   * origin. Private Network Access preflights also need explicit loopback opt-in.
   * See https://developer.chrome.com/blog/private-network-access-preflight.
   */
  function buildCorsHeaders(
    requestOrigin: string | undefined,
    requestedHeaders: string | undefined
  ): Record<string, string> {
    // Credentialed preflights require explicit allowed header names.
    const allowHeaders =
      requestedHeaders && requestedHeaders.trim().length > 0
        ? requestedHeaders
        : "*"
    return {
      "access-control-allow-origin": requestOrigin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods":
        "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
      "access-control-allow-headers": allowHeaders,
      "access-control-expose-headers": "*",
      "access-control-allow-private-network": "true",
      // `Vary: Origin` prevents shared intermediate caches from returning
      // the wrong Allow-Origin to a different requester.
      vary: "Origin",
    }
  }

  const handleRequest: http.RequestListener = async (req, res) => {
    const requestOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin
    const requestedHeadersRaw = req.headers["access-control-request-headers"]
    const requestedHeaders = Array.isArray(requestedHeadersRaw)
      ? requestedHeadersRaw.join(", ")
      : requestedHeadersRaw
    const corsHeaders = productionOrigins
      ? {}
      : buildCorsHeaders(requestOrigin, requestedHeaders)

    try {
      productionOrigins?.onRequest(req)
      const host = req.headers.host ?? ""
      const url = new URL(
        req.url ?? "/",
        productionOrigins ? `https://${host}` : "http://127.0.0.1"
      )

      if (process.env.TMD_TEST_E2E_DIAG === "true") {
        console.log(
          "[local-mock-server]",
          req.method,
          redactDiagnostic(url.pathname)
        )
      }

      // Answer CORS preflight without invoking handlers — the browser
      // sends OPTIONS before credentialed cross-origin fetches, and
      // also for Private Network Access preflights (detectable via
      // `Access-Control-Request-Private-Network: true`).
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders)
        res.end()
        return
      }

      const prefix = productionOrigins?.routePrefixes[host]
      const fixturePath = prefix ? `${prefix}${url.pathname}` : url.pathname
      const match = pickHandler(routes, fixturePath)
      if (!match) {
        res.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
          ...corsHeaders,
        })
        res.end(`No mock handler registered for ${url.pathname}`)
        return
      }

      const body = await readRequestBody(req)
      const result = await match.handler({
        method: req.method ?? "GET",
        url,
        pathnameAfterPrefix: fixturePath.slice(match.prefix.length) || "/",
        body,
        headers: req.headers,
      })

      if (!result) {
        res.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
          ...corsHeaders,
        })
        res.end(`Handler for prefix ${match.prefix} returned null`)
        return
      }

      const { buffer, contentType } = toResponseBuffer(result.body)
      const headers: Record<string, string> = {
        "content-length": String(buffer.length),
        ...(contentType ? { "content-type": contentType } : {}),
        ...corsHeaders,
        ...(result.headers ?? {}),
      }
      res.writeHead(result.status, headers)
      res.end(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        "[local-mock-server] handler threw:",
        redactDiagnostic(error)
      )
      if (!res.headersSent) {
        res.writeHead(500, {
          "content-type": "text/plain; charset=utf-8",
          ...corsHeaders,
        })
      }
      res.end(`Server error: ${message}`)
    }
  }
  const server = productionOrigins
    ? https.createServer(productionOrigins.tls, handleRequest)
    : http.createServer(handleRequest)

  // Bind the final socket above browser-restricted ports. Keeping it open
  // avoids port-claim races between parallel workers.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening)
          reject(error)
        }
        const onListening = () => {
          server.off("error", onError)
          resolve()
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(randomInt(49152, 65536), "127.0.0.1")
      })
      break
    } catch (error) {
      if (
        attempt === 19 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EADDRINUSE" && error.code !== "EACCES")
      )
        throw error
    }
  }

  const addressInfo = server.address() as AddressInfo | null
  if (!addressInfo || typeof addressInfo === "string") {
    server.close()
    throw new Error("Local mock server failed to resolve a listening port")
  }

  let closed = false
  return {
    port: addressInfo.port,
    url: `${productionOrigins ? "https" : "http"}://127.0.0.1:${addressInfo.port}`,
    addRoute(prefix, handler) {
      if (!prefix.startsWith("/")) {
        throw new Error(
          `Mock route prefix must start with '/': received "${prefix}"`
        )
      }
      routes.set(prefix, handler)
    },
    async close() {
      if (closed) return
      closed = true
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
