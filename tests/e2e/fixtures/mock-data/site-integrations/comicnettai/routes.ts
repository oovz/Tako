import type { Route } from '@playwright/test'
import type { RouteRegistrar } from '../../types'
import { COMICNETTAI_TEST_DOMAIN } from '../../../test-domains-constants'
import { BASIC_SERIES_PAGE_HTML, HOME_PAGE_HTML } from './html-fixtures'

export const registerComicNettaiRoutes: RouteRegistrar = async (context, options) => {
  if (!options.useMocks) {
    return
  }

  await context.route(`https://${COMICNETTAI_TEST_DOMAIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url())
    const html = (body: string) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body,
    })

    if (url.pathname === '/book/9' || url.pathname === '/book/9/') {
      return html(BASIC_SERIES_PAGE_HTML)
    }

    if (url.pathname === '/' || url.pathname === '/book') {
      return html(HOME_PAGE_HTML)
    }

    return route.fulfill({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: HOME_PAGE_HTML,
    })
  })
}
