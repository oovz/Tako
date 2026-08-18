import React, { useState } from "react"

import {
  List,
  ChevronDown,
  BookOpen,
  Layers,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { cn } from "@/src/shared/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CollapsibleTrigger } from "@/components/ui/collapsible"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { Volume } from "@/entrypoints/sidepanel/types"
import {
  NO_MANGA_FOUND_MSG,
  TAB_NOT_SUPPORTED_MSG,
} from "@/entrypoints/sidepanel/messages"
import { t } from "@/src/runtime/i18n"

interface SeriesContextCardProps {
  data: SidepanelSeriesContextData
  isExpanded: boolean
  triggerRef?: React.Ref<HTMLButtonElement>
}

export interface SeriesCardMessageState {
  title: string
  description: string
}

export function resolveSeriesCardMessage(
  blockingMessage: string | undefined
): SeriesCardMessageState | null {
  if (!blockingMessage) {
    return null
  }

  if (blockingMessage === TAB_NOT_SUPPORTED_MSG) {
    return {
      title: t("sidepanel_noSeriesDetected"),
      description: t("sidepanel_openSupportedPage"),
    }
  }

  if (blockingMessage === NO_MANGA_FOUND_MSG) {
    return {
      title: t("sidepanel_pageNotRecognized"),
      description: t("sidepanel_openSupportedPage"),
    }
  }

  return {
    title: t("sidepanel_pageNotRecognized"),
    description: t("sidepanel_openSupportedPage"),
  }
}

export function SeriesContextCard({
  data,
  isExpanded,
  triggerRef,
}: SeriesContextCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const messageState = resolveSeriesCardMessage(data.blockingMessage)

  if (data.isLoading) {
    return (
      <div className="flex gap-4">
        <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted animate-pulse" />
        <div className="flex flex-1 flex-col justify-between min-w-0">
          <div className="flex flex-col gap-2">
            <div className="h-5 w-36 bg-muted rounded animate-pulse" />
            <div className="h-4 w-28 bg-muted rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-5 w-24 bg-muted rounded animate-pulse" />
              <div className="h-5 w-20 bg-muted rounded animate-pulse" />
            </div>
          </div>
          <div className="h-9 w-full bg-muted rounded animate-pulse mt-3" />
        </div>
      </div>
    )
  }

  if (messageState) {
    return (
      <div className="flex gap-4">
        <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted flex items-center justify-center text-muted-foreground">
          <BookOpen className="size-8" />
        </div>
        <div className="flex flex-1 flex-col justify-center min-w-0">
          <h2 className="font-bold text-base leading-tight">
            {messageState.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {messageState.description}
          </p>
          <Button
            type="button"
            size="sm"
            variant={isExpanded ? "secondary" : "default"}
            className={cn(
              "w-full gap-2 mt-3 h-9 text-sm shadow-sm",
              isExpanded && "ring-1 ring-border"
            )}
            disabled
            aria-expanded={isExpanded}
            aria-controls="inline-selection-panel"
          >
            <List className="size-4" />
            {t("sidepanel_selectChapters")}
          </Button>
        </div>
      </div>
    )
  }

  if (!data.mangaTitle) {
    return (
      <div className="flex gap-4">
        <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted flex items-center justify-center text-muted-foreground">
          <BookOpen className="size-8" />
        </div>
        <div className="flex flex-1 flex-col justify-center min-w-0">
          <h2 className="font-bold text-base leading-tight">
            {t("sidepanel_noSeriesDetected")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("sidepanel_openSupportedPage")}
          </p>
        </div>
      </div>
    )
  }

  const coverSrc = data.coverUrl || chrome.runtime.getURL("icon/128.png")
  const subtitleParts: string[] = []
  if (data.author) subtitleParts.push(data.author)
  if (data.siteId) subtitleParts.push(getDisplayName(data.siteId))
  const subtitle = subtitleParts.join(" · ")

  const volumeItems = data.items.filter(
    (item): item is Volume => "chapters" in item
  )
  const chaptersCount = data.items.reduce(
    (acc, item) => ("chapters" in item ? acc + item.chapters.length : acc + 1),
    0
  )
  const volumeCount = volumeItems.length

  const hasNoChapters = chaptersCount === 0
  const isChaptersLoading = data.isChaptersLoading

  return (
    <div className="group flex gap-4 transition-all duration-200">
      {/* Cover image - enlarged for better visibility */}
      <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted">
        {coverSrc && (
          <img
            src={coverSrc}
            alt={data.mangaTitle}
            className={cn(
              "h-full w-full object-contain transition-all duration-300 group-hover:scale-105",
              imageLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />
        )}
        {!imageLoaded && (
          <div className="absolute inset-0 bg-muted animate-pulse" />
        )}
      </div>
      {/* Content */}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div>
          <h2
            className="font-bold text-base leading-tight truncate"
            title={data.mangaTitle}
          >
            {data.mangaTitle}
          </h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {subtitle}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isChaptersLoading ? (
              <Badge
                variant="secondary"
                className="text-[10px] h-5 px-2 py-0 gap-1 text-muted-foreground"
              >
                <Loader2 className="size-3 animate-spin" />
                {t("common_loading")}
              </Badge>
            ) : hasNoChapters ? (
              <Badge
                variant="secondary"
                className="text-[10px] h-5 px-2 py-0 gap-1 text-muted-foreground"
              >
                <AlertCircle className="size-3" />
                {t("sidepanel_noChaptersFound")}
              </Badge>
            ) : (
              <>
                <Badge
                  variant="secondary"
                  className="text-[10px] h-5 px-2 py-0 gap-1 shadow-sm"
                >
                  <BookOpen className="size-3" />
                  {t("sidepanel_chaptersCount", [String(chaptersCount)])}
                </Badge>
                {volumeCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-2 py-0 gap-1"
                  >
                    <Layers className="size-3" />
                    {t("sidepanel_volumesCount", [String(volumeCount)])}
                  </Badge>
                )}
              </>
            )}
          </div>
          {data.chapterListNotice === "adult-consent-required" && (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {t("sidepanel_adultConsentRequired")}
            </p>
          )}
        </div>

        {/* Select Chapters button */}
        <CollapsibleTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            size="sm"
            variant={isExpanded ? "secondary" : "default"}
            className={cn(
              "w-full gap-2 mt-3 h-9 text-sm shadow-sm transition-all duration-150 active:scale-[0.98]",
              isExpanded && "ring-1 ring-border"
            )}
            disabled={
              !isExpanded &&
              (hasNoChapters ||
                isChaptersLoading ||
                !!data.blockingMessage ||
                data.tabId == null)
            }
            aria-expanded={isExpanded}
            aria-controls="inline-selection-panel"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="size-4 rotate-180 transition-transform duration-200 ease-out" />
                {t("sidepanel_closeSelection")}
              </>
            ) : isChaptersLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("common_loading")}
              </>
            ) : hasNoChapters ? (
              <>
                <List className="size-4" />
                {t("sidepanel_noChapters")}
              </>
            ) : (
              <>
                <ChevronDown className="size-4 transition-transform duration-200 ease-out" />
                {t("sidepanel_selectChapters")}
              </>
            )}
          </Button>
        </CollapsibleTrigger>
      </div>
    </div>
  )
}
