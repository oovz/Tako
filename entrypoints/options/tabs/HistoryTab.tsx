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
    <div className="space-y-6">
      {/* Statistics Card */}
      <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Series</CardDescription>
              <CardTitle className="text-4xl">{stats?.totalSeries ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">Tracked in history</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Chapters</CardDescription>
              <CardTitle className="text-4xl">{stats?.totalChapters ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">Downloads recorded</div>
            </CardContent>
          </Card>
          {storageBytes !== undefined && (
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Storage Used</CardDescription>
                <CardTitle className="text-4xl">{formatBytes(storageBytes)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">Local storage usage</div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Clear History Actions */}
        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Manage History Data</CardTitle>
            <CardDescription className="text-destructive/80">
              Remove stored chapter history records without affecting files already saved on disk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Clear All History */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium">Clear All History</Label>
                <p className="text-sm text-muted-foreground">
                  Remove all download history for all series
                </p>
              </div>
              <Dialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={isClearing || (stats?.totalChapters ?? 0) === 0}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Everything
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear All Download History?</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <p className="text-sm">
                      This will permanently delete records for <strong>{stats?.totalChapters ?? 0} chapters</strong> across <strong>{stats?.totalSeries ?? 0} series</strong>.
                    </p>
                    <p className="text-sm font-medium text-destructive">
                      This action cannot be undone.
                    </p>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => setClearAllDialogOpen(false)}
                        disabled={isClearing}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleClearAll}
                        disabled={isClearing}
                      >
                        {isClearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Yes, Clear All
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="h-px bg-border/10 w-full" />

            {/* Clear Series History */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-base font-medium">Clear Specific Series</Label>
                <p className="text-sm text-muted-foreground">
                  Remove download history for a single series
                </p>
              </div>
              <Dialog open={clearSeriesDialogOpen} onOpenChange={handleOpenSeriesDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isClearing || (stats?.totalSeries ?? 0) === 0}
                  >
                    Select Series...
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear Series History</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="series-select">Select Series</Label>
                      <Select
                        value={selectedSeriesToClear}
                        onValueChange={setSelectedSeriesToClear}
                      >
                        <SelectTrigger id="series-select">
                          <SelectValue placeholder="Choose a series..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {localSeries.length === 0 ? (
                            <div className="text-sm text-muted-foreground p-2 text-center">
                              No download history found
                            </div>
                          ) : (
                            localSeries.map((s) => (
                              <SelectItem key={s.seriesId} value={s.seriesId}>
                                <span className="flex items-center justify-between w-full gap-4">
                                  <span className="truncate max-w-[200px]">{s.seriesTitle}</span>
                                  <Badge variant="secondary" className="ml-auto text-xs">
                                    {s.chapterCount} ch
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
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleClearSeries}
                        disabled={isClearing || !selectedSeriesToClear}
                      >
                        {isClearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Clear Selected
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
