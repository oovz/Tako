import type {
  SiteIntegrationSeriesData,
  SiteIntegrationSeriesDataset,
} from "../../types"

export const BASIC_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANHUAGUI_BASIC_SERIES",
  description: "Basic Manhuagui series with full metadata (no adult gate)",
  series: {
    siteId: "readmanga",
    seriesId: "55555",
    seriesTitle: "テスト漫画",
    author: "测试作者",
    description: "A Manhuagui fixture series used by e2e tests.",
    coverUrl: "https://cf.mhgui.com/cpic/b/55555.jpg",
    status: "连载中",
  },
  chapterDatasetId: "MANHUAGUI_BASIC",
}

export const ADULT_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANHUAGUI_ADULT_SERIES",
  description:
    "Adult-gated Manhuagui series (chapter list is lz-string-compressed in #__VIEWSTATE)",
  series: {
    siteId: "readmanga",
    seriesId: "77777",
    seriesTitle: "Gated Series",
    author: "测试作者",
    description: "Adult-gated Manhuagui fixture.",
    coverUrl: "https://cf.mhgui.com/cpic/b/77777.jpg",
    status: "已完结",
  },
  chapterDatasetId: "MANHUAGUI_ADULT",
}

export const MINIMAL_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANHUAGUI_MINIMAL_SERIES",
  description: "Manhuagui series with a single chapter",
  series: {
    siteId: "readmanga",
    seriesId: "66666",
    seriesTitle: "Minimal Series",
    status: "连载中",
  },
  chapterDatasetId: "MANHUAGUI_SMALL",
}

export const CATEGORY_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANHUAGUI_CATEGORY_SERIES",
  description:
    "Manhuagui reference series with single issues, extras, and chapters category headings",
  series: {
    siteId: "readmanga",
    seriesId: "21243",
    seriesTitle: "八田百田",
    author: "はやみねかおる",
    description:
      "Reference-style Manhuagui fixture with nonnumeric category headings.",
    coverUrl: "https://cf.mhgui.com/cpic/b/21243.jpg",
    status: "连载中",
  },
  chapterDatasetId: "MANHUAGUI_CATEGORY",
}

export const KIMETSU_SERIES: SiteIntegrationSeriesDataset = {
  id: "MANHUAGUI_KIMETSU_SERIES",
  description:
    "Captured 看漫画 catalog with single-book, single-chapter, and extra category headings",
  series: {
    siteId: "readmanga",
    seriesId: "19430",
    seriesTitle: "鬼灭之刃",
    author: "吾峠呼世晴",
    description: "充满了鬼才的，血雨剑戟冒险谭，正式开幕。",
    coverUrl: "https://cf.mhgui.com/cpic/h/19430.jpg",
    status: "已完结",
  },
  chapterDatasetId: "MANHUAGUI_KIMETSU",
}

export function createManhuaguiSeries(
  overrides: Partial<SiteIntegrationSeriesData>
): SiteIntegrationSeriesData {
  return {
    siteId: overrides.siteId || "readmanga",
    seriesId: overrides.seriesId || BASIC_SERIES.series.seriesId,
    seriesTitle: overrides.seriesTitle || "テスト漫画",
    author: overrides.author,
    description: overrides.description,
    coverUrl: overrides.coverUrl,
    status: overrides.status,
  }
}
