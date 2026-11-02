import type { RouteRegistrar } from "../types"
import type { DnrRedirectRule } from "../../dnr-test-redirects"
import type {
  LocalMockServerHandle,
  MockRouteResponse,
} from "../../local-mock-server"

export type ExpandedSiteCase = {
  id: string
  seriesUrl: string
  seriesId: string
  title: string
  chapterId: string
  pageCount: number
  aliases?: string[]
}

export type FixtureRequest = {
  url: URL
  headers: Record<string, string | string[] | undefined>
  method: string
  body: Buffer
}

export function htmlResponse(body: string): MockRouteResponse {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  }
}

export function jsonResponse(body: object): MockRouteResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  }
}

// Ordered 26×2 strips make the BoyLove transform run on real raster data.
export const PAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABoAAAACCAYAAABGz8w4AAAASUlEQVR4nL3NEQKAQAAAsNM0TYMkTdM0PU3TNE3TNE3TNE3TXlJ7RTBeCEV8E1IyckoqahpaIh09AyMTMwsrGzsHJxc3D+Gv6AOqBmUPS959fwAAAABJRU5ErkJggg==",
  "base64"
)
export function pngResponse(): MockRouteResponse {
  return {
    status: 200,
    headers: { "content-type": "image/png" },
    body: PAGE_PNG,
  }
}

export function createExpandedSiteFixture(input: {
  testCase: ExpandedSiteCase
  origins: string[]
  firstRuleId: number
  handle: (
    request: FixtureRequest
  ) => MockRouteResponse | null | Promise<MockRouteResponse | null>
}): {
  testCase: ExpandedSiteCase
  registerRoutes: RouteRegistrar
  registerLocalServerHandlers(server: LocalMockServerHandle): DnrRedirectRule[]
} {
  const missing: MockRouteResponse = {
    status: 404,
    headers: { "content-type": "text/plain" },
    body: "Unknown deterministic site request",
  }
  return {
    testCase: input.testCase,
    registerRoutes: async (context, options) => {
      if (!options.useMocks) return
      await Promise.all(
        input.origins.map((origin) =>
          context.route(`${origin}/**`, async (route) => {
            const request = route.request()
            const response =
              (await input.handle({
                url: new URL(request.url()),
                headers: request.headers(),
                method: request.method(),
                body: request.postDataBuffer() ?? Buffer.alloc(0),
              })) ?? missing
            const body =
              typeof response.body === "string" ||
              Buffer.isBuffer(response.body)
                ? response.body
                : response.body instanceof Uint8Array
                  ? Buffer.from(response.body)
                  : JSON.stringify(response.body)
            await route.fulfill({
              status: response.status,
              headers: response.headers,
              body,
            })
          })
        )
      )
    },
    registerLocalServerHandlers: (server) =>
      input.origins.map((origin, index) => {
        const prefix = `/__expanded/${input.testCase.id}/${index}`
        server.addRoute(prefix, (request) =>
          input.handle({
            url: new URL(
              `${request.pathnameAfterPrefix}${request.url.search}`,
              origin
            ),
            headers: request.headers,
            method: request.method,
            body: request.body,
          })
        )
        return {
          id: input.firstRuleId + index,
          regexFilter: `^${origin.replaceAll(".", "\\.")}/(.*)$`,
          regexSubstitution: `${server.url}${prefix}/\\1`,
        }
      }),
  }
}
