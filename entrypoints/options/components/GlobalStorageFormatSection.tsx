import { FolderOpen } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import { ArchiveFormatPicker } from '@/entrypoints/options/components/ArchiveFormatPicker'
import { PathVisualization } from '@/entrypoints/options/components/PathVisualization'

interface GlobalStorageFormatSectionProps {
  downloads: ExtensionSettings['downloads']
  showNoArchiveWarning: boolean
  onDownloadsChange: (updates: Partial<ExtensionSettings['downloads']>) => void
}

export function GlobalStorageFormatSection({ downloads, showNoArchiveWarning, onDownloadsChange }: GlobalStorageFormatSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">Storage & Formats</CardTitle>
        </div>
        <CardDescription>Choose archive format and file organization options.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6">
          <ArchiveFormatPicker
            showNoArchiveWarning={showNoArchiveWarning}
            value={downloads.defaultFormat}
            onValueChange={(value) => onDownloadsChange({ defaultFormat: value })}
          />

          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="space-y-1">
                <Label htmlFor="comicinfo">Include ComicInfo.xml</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  Embed metadata for comic readers
                </p>
              </div>
              <Switch
                id="comicinfo"
                data-testid="comicinfo-switch"
                checked={downloads.includeComicInfo}
                onCheckedChange={(checked) => onDownloadsChange({ includeComicInfo: checked })}
              />
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="space-y-1">
                <Label htmlFor="cover-image">Include Series Cover</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  Save cover image inside archive
                </p>
              </div>
              <Switch
                id="cover-image"
                data-testid="cover-image-switch"
                checked={downloads.includeCoverImage}
                onCheckedChange={(checked) => onDownloadsChange({ includeCoverImage: checked })}
              />
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="space-y-1">
                <Label htmlFor="normalize">Normalize Filenames</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  Rename images to 001.jpg, 002.jpg...
                </p>
              </div>
              <Switch
                id="normalize"
                data-testid="normalize-switch"
                checked={downloads.normalizeImageFilenames}
                onCheckedChange={(checked) => onDownloadsChange({ normalizeImageFilenames: checked })}
              />
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="space-y-1">
                <Label htmlFor="overwrite">Overwrite Existing</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  Replace files if they already exist
                </p>
              </div>
              <Switch
                id="overwrite"
                data-testid="overwrite-switch"
                checked={downloads.overwriteExisting}
                onCheckedChange={(checked) => onDownloadsChange({ overwriteExisting: checked })}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <Label htmlFor="download-path" className="text-sm font-medium">Directory Path Template</Label>
              <Input
                id="download-path"
                data-testid="download-path-input"
                value={downloads.pathTemplate}
                onChange={(e) => onDownloadsChange({ pathTemplate: e.target.value })}
                placeholder="<SERIES_TITLE>/<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use macros: &lt;SERIES_TITLE&gt;, &lt;CHAPTER_NUMBER&gt;, &lt;CHAPTER_TITLE&gt;, &lt;VOLUME_NUMBER&gt;
              </p>
            </div>

            <div className="space-y-3">
              <Label htmlFor="filename-template" className="text-sm font-medium">Filename Template</Label>
              <Input
                id="filename-template"
                data-testid="filename-template-input"
                value={downloads.fileNameTemplate || ''}
                onChange={(e) => onDownloadsChange({ fileNameTemplate: e.target.value || undefined })}
                placeholder="<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Template for the archive/folder name. Supports same macros plus &lt;CHAPTER_NUMBER_PAD2&gt;, &lt;CHAPTER_NUMBER_PAD3&gt;.
              </p>
            </div>

            <PathVisualization
              template={downloads.pathTemplate}
              filenameTemplate={downloads.fileNameTemplate || '<CHAPTER_TITLE>'}
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="image-padding" className="text-sm font-medium">Image Filename Padding</Label>
            <Select
              value={String(downloads.imagePaddingDigits ?? 'auto')}
              onValueChange={(value) => onDownloadsChange({ imagePaddingDigits: value === 'auto' ? 'auto' : parseInt(value) as 2 | 3 | 4 | 5 })}
            >
              <SelectTrigger id="image-padding" data-testid="image-padding-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (based on total images)</SelectItem>
                <SelectItem value="2">2 digits (01-99)</SelectItem>
                <SelectItem value="3">3 digits (001-999)</SelectItem>
                <SelectItem value="4">4 digits (0001-9999)</SelectItem>
                <SelectItem value="5">5 digits (00001-99999)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Zero-padding for normalized image filenames (e.g., 001.jpg, 002.jpg).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
