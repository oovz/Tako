/**
 * @file local-mock-server.ts
 * @description Local HTTP mock server that sits behind our DNR redirects.
 *
 * Why a local server (instead of pure Playwright `context.route`)?
 *
 * Playwright's `context.route` intercepts fetches from pages, content
 * scripts, service workers, and extension pages (options, side panel).
 * It does NOT reliably intercept fetches from offscreen documents — and
 * our `resolveImageUrls` / `downloadImage` calls all run in offscreen
 * (see `entrypoints/offscreen/main.ts`).
 *
 * To plug that hole we run a local HTTP server on a random ephemeral
 * port, then install `chrome.declarativeNetRequest` session rules (see
 * `dnr-test-redirects.ts`) that rewrite specific external URLs to
 * `http://127.0.0.1:<port>/<prefix>/...`. DNR rules apply to all
 * extension-initiated requests (SW, offscreen, pages) so they close the
 * offscreen gap.
 *
 * Dispatch is path-prefix based: each integration reserves a prefix like
 * `/manhuagui`, `/hamreus`, `/mangadex-api` and registers a handler under
 * that prefix. The first matching prefix wins; the most specific prefix
 * should be registered first (longer strings before shorter).
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Response payload returned by a `MockRouteHandler`.
 *
 * `body` may be a `Buffer`, `string`, or arbitrary object (objects are
 * JSON-stringified with `application/json; charset=utf-8` unless the
 * handler sets a `content-type` header itself).
 */
export interface MockRouteResponse {
  status: number;
  headers?: Record<string, string>;
  body: Buffer | string | Uint8Array | object;
}

/**
 * Shape passed to every `MockRouteHandler`.
 *
 * `pathnameAfterPrefix` is the portion of the request path AFTER the
 * matched prefix (leading `/` preserved when present). Handlers should
 * dispatch on this value rather than `url.pathname` so they remain
 * decoupled from the prefix chosen by the fixture caller.
 */
export interface MockRouteRequest {
  method: string;
  url: URL;
  pathnameAfterPrefix: string;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

export type MockRouteHandler = (req: MockRouteRequest) => Promise<MockRouteResponse | null> | MockRouteResponse | null;

export interface LocalMockServerHandle {
  /** Port the server is listening on (127.0.0.1 only). */
  readonly port: number;
  /** Full base URL, e.g. `http://127.0.0.1:49152`. */
  readonly url: string;
  /**
   * Register a handler for a pathname prefix. Prefixes SHOULD start with
   * `/` (e.g. `/manhuagui`). Returning `null` from the handler yields a
   * 404. Later-registered prefixes override earlier ones for the same
   * exact string, but overlapping prefixes are matched longest-first.
   */
  readonly addRoute: (prefix: string, handler: MockRouteHandler) => void;
  /** Tear down the server; safe to call multiple times. */
  readonly close: () => Promise<void>;
}

function toResponseBuffer(body: MockRouteResponse['body']): { buffer: Buffer; contentType?: string } {
  if (Buffer.isBuffer(body)) return { buffer: body };
  if (body instanceof Uint8Array) return { buffer: Buffer.from(body) };
  if (typeof body === 'string') return { buffer: Buffer.from(body, 'utf8') };
  return {
    buffer: Buffer.from(JSON.stringify(body), 'utf8'),
    contentType: 'application/json; charset=utf-8',
  };
}

function pickHandler(
  routes: Map<string, MockRouteHandler>,
  pathname: string,
): { prefix: string; handler: MockRouteHandler } | undefined {
  let best: { prefix: string; handler: MockRouteHandler } | undefined;
  for (const [prefix, handler] of routes) {
    if (pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, handler };
      }
    }
  }
  return best;
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function startLocalMockServer(): Promise<LocalMockServerHandle> {
  const routes = new Map<string, MockRouteHandler>();

  /**
   * CORS headers attached to every response.
   *
   * Two separate cross-origin concerns apply to the DNR-redirected
   * fetches we answer:
   *
   * 1. **Plain CORS**: Extension offscreen / SW fetches go cross-origin
   *    from the chrome-extension:// origin, and page-context fetches
   *    from mangadex.org etc. are also cross-origin to 127.0.0.1.
   *    Since the production fetch path uses `credentials: 'include'`
   *    (see `src/runtime/rate-limit.ts`) we can't respond with
   *    `Access-Control-Allow-Origin: *`; instead we echo the exact
   *    Origin header — including the literal string `null` that DNR
   *    redirects across scheme boundaries tend to produce.
   *
   * 2. **Private Network Access (PNA)**: Chrome blocks public-origin
   *    pages (mangadex.org, comic.pixiv.net, etc.) from fetching
   *    loopback / local addresses unless the response opts in via
   *    `Access-Control-Allow-Private-Network: true` (set on the
   *    preflight and also on the actual response). DNR-redirected
   *    fetches keep the original initiator origin, so without this
   *    header the browser surfaces
   *    `Permission was denied for this request to access the loopback
   *    address space.` and the request fails with `ERR_FAILED`.
   *    See: https://developer.chrome.com/blog/private-network-access-preflight
   */
  function buildCorsHeaders(
    requestOrigin: string | undefined,
    requestedHeaders: string | undefined,
  ): Record<string, string> {
    // With `credentials: 'include'` Chrome refuses to interpret `*` in
    // `Access-Control-Allow-Headers` as a wildcard — it must echo the
    // exact header names the preflight requested. Without the echo, any
    // custom request header (e.g. the Pixiv `x-client-hash` /
    // `x-requested-with`) fails the preflight and the actual fetch
    // surfaces as a generic `TypeError: Failed to fetch`. Echoing the
    // requested headers ensures all preflights succeed regardless of
    // which integration happens to set custom request headers.
    const allowHeaders = requestedHeaders && requestedHeaders.trim().length > 0
      ? requestedHeaders
      : '*';
    return {
      'access-control-allow-origin': requestOrigin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH',
      'access-control-allow-headers': allowHeaders,
      'access-control-expose-headers': '*',
      'access-control-allow-private-network': 'true',
      // `Vary: Origin` prevents shared intermediate caches from returning
      // the wrong Allow-Origin to a different requester.
      'vary': 'Origin',
    };
  }

  const server = http.createServer(async (req, res) => {
    const requestOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    const requestedHeadersRaw = req.headers['access-control-request-headers'];
    const requestedHeaders = Array.isArray(requestedHeadersRaw)
      ? requestedHeadersRaw.join(', ')
      : requestedHeadersRaw;
    const corsHeaders = buildCorsHeaders(requestOrigin, requestedHeaders);

    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (process.env.TMD_TEST_E2E_DIAG === 'true') {
        console.log('[local-mock-server]', req.method, url.pathname);
      }

      // Answer CORS preflight without invoking handlers — the browser
      // sends OPTIONS before credentialed cross-origin fetches, and
      // also for Private Network Access preflights (detectable via
      // `Access-Control-Request-Private-Network: true`).
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      const match = pickHandler(routes, url.pathname);
      if (!match) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders });
        res.end(`No mock handler registered for ${url.pathname}`);
        return;
      }

      const body = await readRequestBody(req);
      const result = await match.handler({
        method: req.method ?? 'GET',
        url,
        pathnameAfterPrefix: url.pathname.slice(match.prefix.length) || '/',
        body,
        headers: req.headers,
      });

      if (!result) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders });
        res.end(`Handler for prefix ${match.prefix} returned null`);
        return;
      }

      const { buffer, contentType } = toResponseBuffer(result.body);
      const headers: Record<string, string> = {
        'content-length': String(buffer.length),
        ...(contentType ? { 'content-type': contentType } : {}),
        ...corsHeaders,
        ...(result.headers ?? {}),
      };
      res.writeHead(result.status, headers);
      res.end(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[local-mock-server] handler threw:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders });
      }
      res.end(`Server error: ${message}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const addressInfo = server.address() as AddressInfo | null;
  if (!addressInfo || typeof addressInfo === 'string') {
    server.close();
    throw new Error('Local mock server failed to resolve a listening port');
  }

  let closed = false;
  return {
    port: addressInfo.port,
    url: `http://127.0.0.1:${addressInfo.port}`,
    addRoute(prefix, handler) {
      if (!prefix.startsWith('/')) {
        throw new Error(`Mock route prefix must start with '/': received "${prefix}"`);
      }
      routes.set(prefix, handler);
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
