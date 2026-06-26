import { Folder } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { ExtensionSettings } from '@/src/storage/settings-types'

interface DownloadDestinationSectionProps {
  downloads: ExtensionSettings['downloads']
  selectedFolderName: string | null
  isPickingFolder: boolean
  onDownloadsChange: (updates: Partial<ExtensionSettings['downloads']>) => void
  onPickFolder: () => Promise<void>
}

export function DownloadDestinationSection({ downloads, selectedFolderName, isPickingFolder, onDownloadsChange, onPickFolder }: DownloadDestinationSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Download destination</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col gap-1 pr-4">
            <Label htmlFor="custom-folder-switch">Use custom folder (File System Access)</Label>
            <p className="text-xs text-muted-foreground">
              {selectedFolderName ? `Current folder: ${selectedFolderName}` : 'No custom folder selected. Uses default browser downloads.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Custom folder mode always overwrites existing files with the same name.
            </p>
          </div>
          <Switch
            id="custom-folder-switch"
            checked={downloads.downloadMode === 'custom'}
            onCheckedChange={(checked) => {
              onDownloadsChange({
                downloadMode: checked ? 'custom' : 'browser',
                customDirectoryEnabled: checked,
              })
            }}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onPickFolder} disabled={isPickingFolder}>
            <Folder data-icon="inline-start" className="size-3.5" />
            {selectedFolderName ? 'Change folder' : 'Select folder'}
          </Button>
          {selectedFolderName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDownloadsChange({
                  downloadMode: 'browser',
                  customDirectoryEnabled: false,
                })
              }}
            >
              Use browser downloads
            </Button>
          )}
        </div>

        {downloads.downloadMode === 'custom' && (
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Custom folder mode ignores the overwrite setting and always replaces same-name files in the selected folder.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
