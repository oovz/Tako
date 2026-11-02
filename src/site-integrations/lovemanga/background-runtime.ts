import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from "@/src/types/site-integrations"
import { createHtmlSeriesResolver } from "../html-series-resolver"
import { aimanhuaPage } from "./reader"

const background: ServiceWorkerIntegration = {
  name: "Aimanhua Background",
  series: {
    resolveSeriesData: createHtmlSeriesResolver({
      integrationId: "lovemanga",
      endpointId: "lovemanga-page",
      normalizeUrl: aimanhuaPage,
      errorLabel: "Aimanhua",
    }),
  },
}
export const backgroundSiteAdapter: BackgroundSiteAdapter = { background }
