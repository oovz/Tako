import type { Route } from "@playwright/test"
import type { RouteRegistrar } from "../../types"
import { MANGAMILLION_TEST_DOMAIN } from "../../../test-domains-constants"
import { BASIC_SERIES_PAGE_HTML, HOME_PAGE_HTML } from "./html-fixtures"

export const registerMangaMillionRoutes: RouteRegistrar = async (
  context,
  options
) => {
  if (!options.useMocks) {
    return
  }

  await context.route(
    `https://${MANGAMILLION_TEST_DOMAIN}/**`,
    async (route: Route) => {
      const url = new URL(route.request().url())
      const html = (body: string) =>
        route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body,
        })

      if (
        url.pathname === "/title/1" ||
        url.pathname === "/title/1/" ||
        url.pathname === "/en/title/1" ||
        url.pathname === "/en/title/1/" ||
        url.pathname.startsWith("/en/title/1/chapter/") ||
        url.pathname.startsWith("/title/1/chapter/")
      ) {
        return html(BASIC_SERIES_PAGE_HTML)
      }

      if (
        url.pathname === "/" ||
        url.pathname === "/en" ||
        url.pathname === "/en/"
      ) {
        return html(HOME_PAGE_HTML)
      }

      return html(BASIC_SERIES_PAGE_HTML)
    }
  )
}
