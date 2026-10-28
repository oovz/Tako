import type { SiteIntegrationChapterDataset } from "../../types"
import products from "@/tests/fixtures/site-integrations/shonenjumpplus/captured-products.json" with { type: "json" }

export const BASIC_CHAPTERS: SiteIntegrationChapterDataset = {
  id: "SHONENJUMPPLUS_BASIC",
  description:
    "183 captured SPY×FAMILY catalog entries, including rental chapters",
  chapters: products.map((product, index) => ({
    id: product.readable_product_id,
    url: product.viewer_uri,
    title: product.title,
    index: index + 1,
    chapterNumber: Number(product.title.match(/\d+/)?.[0]) || undefined,
    chapterLabel: product.title,
    locked: product.status.label !== "is_free",
    status: "queued",
    lastUpdated: 0,
  })),
}

export const SMALL_SERIES: SiteIntegrationChapterDataset = {
  id: "SHONENJUMPPLUS_SMALL",
  description:
    "Synthetic one-chapter navigation context derived from SPY×FAMILY",
  chapters: [
    {
      id: "3269754496649675702",
      url: "https://shonenjumpplus.com/episode/3269754496649675702",
      title: "1話",
      index: 1,
      chapterNumber: 1,
      status: "queued",
      lastUpdated: 0,
    },
  ],
}
