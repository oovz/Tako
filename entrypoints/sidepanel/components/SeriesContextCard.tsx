import React, { useState } from 'react'

import { List, ChevronDown, BookOpen, Layers, AlertCircle } from 'lucide-react'
import { cn } from '@/src/shared/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SidepanelSeriesContextData } from '@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext'
import { getSiteIntegrationDisplayName } from '@/src/site-integrations/manifest'
import type { Volume } from '@/entrypoints/sidepanel/types'
import { NO_MANGA_FOUND_MSG, TAB_NOT_SUPPORTED_MSG } from '@/entrypoints/sidepanel/messages'

interface SeriesContextCardProps {
  data: SidepanelSeriesContextData
  isExpanded: boolean
  onToggleInlineSelection: () => void
}

export interface SeriesCardMessageState {
  title: string
  description: string
}

export function resolveSeriesCardMessage(blockingMessage: string | undefined): SeriesCardMessageState | null {
  if (!blockingMessage) {
    return null
  }

  if (blockingMessage === TAB_NOT_SUPPORTED_MSG) {
    return {
      title: 'No series detected',
      description: 'Open a supported manga series page to get started.',
    }
  }

  if (blockingMessage === NO_MANGA_FOUND_MSG) {
    return {
      title: 'This page is not recognized as a manga series',
      description: 'Open a supported manga series page to get started.',
    }
  }

  return {
    title: 'This page is not recognized as a manga series',
    description: blockingMessage,
  }
}

export function SeriesContextCard({ data, isExpanded, onToggleInlineSelection }: SeriesContextCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const messageState = resolveSeriesCardMessage(data.blockingMessage)

  if (data.isLoading) {
    return (
      <div className="flex gap-4">
        <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted animate-pulse" />
        <div className="flex flex-1 flex-col justify-between min-w-0">
          <div className="space-y-2">
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
          <BookOpen className="h-8 w-8" />
        </div>
        <div className="flex flex-1 flex-col justify-center min-w-0">
          <h2 className="font-bold text-base leading-tight">{messageState.title}</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {messageState.description}
          </p>
          <Button
            type="button"
            size="sm"
            variant={isExpanded ? 'secondary' : 'default'}
            className={cn(
              "w-full gap-2 mt-3 h-9 text-sm shadow-sm",
              isExpanded && "ring-1 ring-border"
            )}
            disabled
            aria-expanded={isExpanded}
            aria-controls="inline-selection-panel"
            onClick={onToggleInlineSelection}
          >
            <List className="h-4 w-4" />
            Select Chapters
          </Button>
        </div>
      </div>
    )
  }

  if (!data.mangaTitle) {
    return (
      <div className="flex gap-4">
        <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted flex items-center justify-center text-muted-foreground">
          <BookOpen className="h-8 w-8" />
        </div>
        <div className="flex flex-1 flex-col justify-center min-w-0">
          <h2 className="font-bold text-base leading-tight">No series detected</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Open a supported manga series page to get started.
          </p>
        </div>
      </div>
    )
  }

  const coverSrc = data.coverUrl || chrome.runtime.getURL('icon/128.png')
  const subtitleParts: string[] = []
  if (data.author) subtitleParts.push(data.author)
  if (data.siteId) subtitleParts.push(getSiteIntegrationDisplayName(data.siteId))
  const subtitle = subtitleParts.join(' · ')

  const volumeItems = data.items.filter(
    (item): item is Volume => 'chapters' in item,
  )
  const chaptersCount = data.items.reduce((acc, item) => (
    'chapters' in item ? acc + item.chapters.length : acc + 1
  ), 0)
  const volumeCount = volumeItems.length

  const hasNoChapters = chaptersCount === 0

  return (
    <div className="flex gap-4">
      {/* Cover image - enlarged for better visibility */}
      <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-md bg-muted">
        {coverSrc && (
          <img
            src={coverSrc}
            alt={data.mangaTitle}
            className={cn(
              "h-full w-full object-contain transition-opacity duration-300",
              imageLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />
        )}
        {!imageLoaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div>
          <h2 className="font-bold text-base leading-tight truncate" title={data.mangaTitle}>
            {data.mangaTitle}
          </h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {hasNoChapters ? (
              <Badge variant="secondary" className="text-[10px] h-5 px-2 py-0 gap-1 text-muted-foreground">
                <AlertCircle className="h-3 w-3" />
                No chapters found
              </Badge>
            ) : (
              <>
                <Badge variant="secondary" className="text-[10px] h-5 px-2 py-0 gap-1 shadow-sm">
                  <BookOpen className="h-3 w-3" />
                  {chaptersCount} Chapters
                </Badge>
                {volumeCount > 0 && (
                  <Badge variant="outline" className="text-[10px] h-5 px-2 py-0 gap-1">
                    <Layers className="h-3 w-3" />
                    {volumeCount} Volumes
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>

        {/* Select Chapters button */}
        <Button
          type="button"
          size="sm"
          variant={isExpanded ? 'secondary' : 'default'}
          className={cn(
            "w-full gap-2 mt-3 h-9 text-sm shadow-sm",
            isExpanded && "ring-1 ring-border"
          )}
          disabled={hasNoChapters || !!data.blockingMessage || data.tabId == null}
          aria-expanded={isExpanded}
          aria-controls="inline-selection-panel"
          onClick={onToggleInlineSelection}
        >
          {hasNoChapters ? (
            <>
              <List className="h-4 w-4" />
              No chapters
            </>
          ) : isExpanded ? (
            <>
              <ChevronDown className="h-4 w-4" />
              Close Selection
            </>
          ) : (
            <>
              <List className="h-4 w-4" />
              Select Chapters
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

