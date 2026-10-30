import React from "react"
import { CoverPreview } from "@/entrypoints/sidepanel/components/CoverPreview"

import {
  List,
  ChevronDown,
  BookOpen,
  Layers,
  AlertCircle,
  Loader2,
  RotateCw,
} from "lucide-react"
import { cn } from "@/src/shared/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CollapsibleTrigger } from "@/components/ui/collapsible"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { getDisplayName } from "@/src/site-integrations/catalog"
import type { CoverPreviewIdentity } from "@/entrypoints/sidepanel/services/cover-preview-loader"
import { getInlineSelectionViewSummary } from "./series-inline-selection-helpers"
import { TAB_NOT_SUPPORTED_MSG } from "@/entrypoints/sidepanel/messages"
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

  return {
    title: t("sidepanel_pageNotRecognized"),
    description: t("sidepanel_openSupportedPage"),
  }
}

function SeriesCardLoading() {
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

function SeriesMessageAction({ data, isExpanded }: SeriesContextCardProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={isExpanded ? "secondary" : "default"}
      className={cn(
        "w-full gap-2 mt-3 h-9 text-sm shadow-sm",
        isExpanded && "ring-1 ring-border"
      )}
      disabled={!data.retrySeriesContext}
      onClick={data.retrySeriesContext}
      aria-expanded={data.retrySeriesContext ? undefined : isExpanded}
      aria-controls={
        data.retrySeriesContext ? undefined : "inline-selection-panel"
      }
    >
      {data.retrySeriesContext ? (
        <RotateCw className="size-4" />
      ) : (
        <List className="size-4" />
      )}
      {t(
        data.retrySeriesContext
          ? "sidepanel_retrySeriesContext"
          : "sidepanel_selectChapters"
      )}
    </Button>
  )
}

function SeriesCardMessage({
  data,
  isExpanded,
  messageState,
  showAction,
}: SeriesContextCardProps & {
  messageState: SeriesCardMessageState
  showAction: boolean
}) {
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
        {showAction && (
          <SeriesMessageAction data={data} isExpanded={isExpanded} />
        )}
      </div>
    </div>
  )
}

function buildSeriesCoverIdentity(
  data: SidepanelSeriesContextData
): CoverPreviewIdentity | undefined {
  return data.siteId &&
    data.coverUrl &&
    data.seriesId &&
    data.tabId !== undefined &&
    data.windowId !== undefined &&
    data.seriesRevision !== undefined
    ? {
        integrationId: data.siteId,
        coverUrl: data.coverUrl,
        source: {
          kind: "series",
          tabId: data.tabId,
          windowId: data.windowId,
          seriesId: data.seriesId,
          seriesRevision: data.seriesRevision,
        },
      }
    : undefined
}

function SeriesChapterSummary({
  chapterCount,
  volumeCount,
  isLoading,
}: {
  chapterCount: number
  volumeCount: number
  isLoading: boolean
}) {
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {isLoading ? (
        <Badge
          variant="secondary"
          className="text-[10px] h-5 px-2 py-0 gap-1 text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" />
          {t("common_loading")}
        </Badge>
      ) : chapterCount === 0 ? (
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
            {t("sidepanel_chaptersCount", [String(chapterCount)])}
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
  )
}

function SeriesSelectionLabel({
  isExpanded,
  isLoading,
  hasNoChapters,
}: {
  isExpanded: boolean
  isLoading: boolean
  hasNoChapters: boolean
}) {
  return isExpanded ? (
    <>
      <ChevronDown className="size-4 rotate-180 transition-transform duration-200 ease-out" />
      {t("sidepanel_closeSelection")}
    </>
  ) : isLoading ? (
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
  )
}

function SeriesSelectionTrigger({
  data,
  isExpanded,
  triggerRef,
  hasNoChapters,
}: SeriesContextCardProps & { hasNoChapters: boolean }) {
  return (
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
            data.isChaptersLoading ||
            !!data.blockingMessage ||
            data.tabId == null)
        }
        aria-expanded={isExpanded}
        aria-controls="inline-selection-panel"
      >
        <SeriesSelectionLabel
          isExpanded={isExpanded}
          isLoading={data.isChaptersLoading}
          hasNoChapters={hasNoChapters}
        />
      </Button>
    </CollapsibleTrigger>
  )
}

function RecognizedSeriesCard({
  data,
  isExpanded,
  triggerRef,
}: SeriesContextCardProps) {
  const subtitle = [
    data.author,
    data.siteId ? getDisplayName(data.siteId) : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
  const { chapterCount, volumeCount } = getInlineSelectionViewSummary(
    data.items
  )

  return (
    <div className="group flex gap-4 transition-all duration-200">
      <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted">
        <CoverPreview
          identity={buildSeriesCoverIdentity(data)}
          alt={data.mangaTitle}
          className="object-contain transition-all duration-300 group-hover:scale-105"
        />
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
          <SeriesChapterSummary
            chapterCount={chapterCount}
            volumeCount={volumeCount}
            isLoading={data.isChaptersLoading}
          />
          {data.chapterListNotice === "adult-consent-required" && (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {t("sidepanel_adultConsentRequired")}
            </p>
          )}
        </div>

        <SeriesSelectionTrigger
          data={data}
          isExpanded={isExpanded}
          triggerRef={triggerRef}
          hasNoChapters={chapterCount === 0}
        />
      </div>
    </div>
  )
}

export function SeriesContextCard(props: SeriesContextCardProps) {
  const { data } = props
  if (data.isLoading) return <SeriesCardLoading />

  const messageState = data.retrySeriesContext
    ? {
        title: t("sidepanel_seriesLoadFailed"),
        description: t("sidepanel_retrySeriesDescription"),
      }
    : resolveSeriesCardMessage(data.blockingMessage)
  if (messageState) {
    return (
      <SeriesCardMessage {...props} messageState={messageState} showAction />
    )
  }
  if (!data.mangaTitle) {
    return (
      <SeriesCardMessage
        {...props}
        messageState={{
          title: t("sidepanel_noSeriesDetected"),
          description: t("sidepanel_openSupportedPage"),
        }}
        showAction={false}
      />
    )
  }
  return <RecognizedSeriesCard {...props} />
}
