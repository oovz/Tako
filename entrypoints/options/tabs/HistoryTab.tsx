/**
 * HistoryTab - Download history management
 * Minimal extraction from main options file
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { t } from '@/src/shared/i18n'

interface HistoryStats {
  totalChapters: number
  totalSeries: number
}

interface SeriesHistory {
  seriesId: string
  seriesTitle: string
  chapterCount: number
}

interface HistoryTabProps {
  stats: HistoryStats | null
  series: SeriesHistory[]
  onClearAll: () => Promise<void>
  onClearSeries: (seriesId: string) => Promise<void>
  onRefreshSeries: () => Promise<SeriesHistory[]>
  isClearing: boolean
  storageBytes?: number
}

export function HistoryTab({
  stats,
  series,
  onClearAll,
  onClearSeries,
  onRefreshSeries,
  isClearing,
  storageBytes
}: HistoryTabProps) {
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)
  const [clearSeriesDialogOpen, setClearSeriesDialogOpen] = useState(false)
  const [selectedSeriesToClear, setSelectedSeriesToClear] = useState('')
  const [localSeries, setLocalSeries] = useState(series)

  const handleClearAll = async () => {
    await onClearAll()
    setClearAllDialogOpen(false)
  }

  const handleClearSeries = async () => {
    if (!selectedSeriesToClear) return
    await onClearSeries(selectedSeriesToClear)
    setSelectedSeriesToClear('')
    setClearSeriesDialogOpen(false)
  }

  const handleOpenSeriesDialog = async (open: boolean) => {
    if (open) {
      const refreshed = await onRefreshSeries()
      setLocalSeries(refreshed)
    } else {
      setSelectedSeriesToClear('')
    }
    setClearSeriesDialogOpen(open)
  }

  const formatBytes = (bytes: number): string => {
    const thresh = 1024
    if (Math.abs(bytes) < thresh) {
      return `${bytes} B`
    }
    const units = ['KB', 'MB', 'GB', 'TB']
    let u = -1
    let b = bytes
    do {
      b /= thresh
      ++u
    } while (Math.abs(b) >= thresh && u < units.length - 1)
    return `${b.toFixed(1)} ${units[u]}`
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Statistics Card */}
      <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('options_totalSeries')}</CardDescription>
              <CardTitle className="text-4xl">{stats?.totalSeries ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">{t('options_trackedInHistory')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('options_totalChapters')}</CardDescription>
              <CardTitle className="text-4xl">{stats?.totalChapters ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">{t('options_downloadsRecorded')}</div>
            </CardContent>
          </Card>
          {storageBytes !== undefined && (
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t('options_storageUsed')}</CardDescription>
                <CardTitle className="text-4xl">{formatBytes(storageBytes)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">{t('options_localStorageUsage')}</div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Clear History Actions */}
        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">{t('options_manageHistoryData')}</CardTitle>
            <CardDescription className="text-destructive/80">
              {t('options_manageHistoryDataDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* Clear All History */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <Label className="text-base font-medium">{t('options_clearAllHistory')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('options_clearAllHistoryDesc')}
                </p>
              </div>
              <Dialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={isClearing || (stats?.totalChapters ?? 0) === 0}
                  >
                    <Trash2 data-icon="inline-start" className="size-4" />
                    {t('options_clearEverything')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('options_clearAllDownloadHistory')}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <p className="text-sm">
                      {t('options_clearAllWarning', [String(stats?.totalChapters ?? 0), String(stats?.totalSeries ?? 0)])}
                    </p>
                    <p className="text-sm font-medium text-destructive">
                      {t('options_cannotBeUndone')}
                    </p>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => setClearAllDialogOpen(false)}
                        disabled={isClearing}
                      >
                        {t('common_cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleClearAll}
                        disabled={isClearing}
                      >
                        {isClearing && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
                        {t('options_clearAll')}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Separator />

            {/* Clear Series History */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <Label className="text-base font-medium">{t('options_clearSpecificSeries')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('options_clearSpecificSeriesDesc')}
                </p>
              </div>
              <Dialog open={clearSeriesDialogOpen} onOpenChange={handleOpenSeriesDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isClearing || (stats?.totalSeries ?? 0) === 0}
                  >
                    {t('options_selectSeriesDots')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('options_clearSeriesHistory')}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="series-select">{t('options_selectSeries')}</Label>
                      <Select
                        value={selectedSeriesToClear}
                        onValueChange={setSelectedSeriesToClear}
                      >
                        <SelectTrigger id="series-select">
                          <SelectValue placeholder={t('options_chooseSeries')} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {localSeries.length === 0 ? (
                            <div className="text-sm text-muted-foreground p-2 text-center">
                              {t('options_noHistoryFound')}
                            </div>
                          ) : (
                            localSeries.map((s) => (
                              <SelectItem key={s.seriesId} value={s.seriesId}>
                                <span className="flex items-center justify-between w-full gap-4">
                                  <span className="truncate max-w-[200px]">{s.seriesTitle}</span>
                                  <Badge variant="secondary" className="ml-auto text-xs">
                                    {t('options_chCount', [String(s.chapterCount)])}
                                  </Badge>
                                </span>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2 justify-end pt-4">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setClearSeriesDialogOpen(false)
                          setSelectedSeriesToClear('')
                        }}
                        disabled={isClearing}
                      >
                        {t('common_cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleClearSeries}
                        disabled={isClearing || !selectedSeriesToClear}
                      >
                        {isClearing && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
                        {t('options_clearSelected')}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
    </div>
  )
}
