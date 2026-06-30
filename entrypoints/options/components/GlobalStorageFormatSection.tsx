import { FolderOpen } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import { ArchiveFormatPicker } from '@/entrypoints/options/components/ArchiveFormatPicker'
import { PathVisualization } from '@/entrypoints/options/components/PathVisualization'
import { t } from '@/src/runtime/i18n'

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
          <CardTitle className="text-base">{t('options_storageFormats')}</CardTitle>
        </div>
        <CardDescription>{t('options_storageFormatsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-6">
          <ArchiveFormatPicker
            showNoArchiveWarning={showNoArchiveWarning}
            value={downloads.defaultFormat}
            onValueChange={(value) => onDownloadsChange({ defaultFormat: value })}
          />

          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="flex flex-col gap-1">
                <Label htmlFor="comicinfo">{t('options_includeComicInfo')}</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  {t('options_includeComicInfoDesc')}
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="cover-image">{t('options_includeCover')}</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  {t('options_includeCoverDesc')}
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="normalize">{t('options_normalizeFilenames')}</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  {t('options_normalizeFilenamesDesc')}
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="overwrite">{t('options_overwriteExisting')}</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  {t('options_overwriteExistingDesc')}
                </p>
              </div>
              <Switch
                id="overwrite"
                data-testid="overwrite-switch"
                checked={downloads.overwriteExisting}
                onCheckedChange={(checked) => onDownloadsChange({ overwriteExisting: checked })}
              />
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-border bg-card">
              <div className="flex flex-col gap-1">
                <Label htmlFor="suppress-save-as">{t('options_suppressSaveAs')}</Label>
                <p className="text-xs text-muted-foreground pr-4">
                  {t('options_suppressSaveAsDesc')}
                </p>
              </div>
              <Switch
                id="suppress-save-as"
                data-testid="suppress-save-as-switch"
                checked={downloads.suppressSaveAsDialog}
                onCheckedChange={(checked) => onDownloadsChange({ suppressSaveAsDialog: checked })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="download-path" className="text-sm font-medium">{t('options_directoryPathTemplate')}</Label>
              <Input
                id="download-path"
                data-testid="download-path-input"
                value={downloads.pathTemplate}
                onChange={(e) => onDownloadsChange({ pathTemplate: e.target.value })}
                placeholder="<SERIES_TITLE>/<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('options_pathTemplateMacros')}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Label htmlFor="filename-template" className="text-sm font-medium">{t('options_filenameTemplate')}</Label>
              <Input
                id="filename-template"
                data-testid="filename-template-input"
                value={downloads.fileNameTemplate || ''}
                onChange={(e) => onDownloadsChange({ fileNameTemplate: e.target.value || undefined })}
                placeholder="<CHAPTER_TITLE>"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('options_filenameTemplateDesc')}
              </p>
            </div>

            <PathVisualization
              template={downloads.pathTemplate}
              filenameTemplate={downloads.fileNameTemplate || '<CHAPTER_TITLE>'}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Label htmlFor="image-padding" className="text-sm font-medium">{t('options_imagePadding')}</Label>
            <Select
              value={String(downloads.imagePaddingDigits ?? 'auto')}
              onValueChange={(value) => onDownloadsChange({ imagePaddingDigits: value === 'auto' ? 'auto' : parseInt(value) as 2 | 3 | 4 | 5 })}
            >
              <SelectTrigger id="image-padding" data-testid="image-padding-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('options_paddingAuto')}</SelectItem>
                <SelectItem value="2">{t('options_padding2')}</SelectItem>
                <SelectItem value="3">{t('options_padding3')}</SelectItem>
                <SelectItem value="4">{t('options_padding4')}</SelectItem>
                <SelectItem value="5">{t('options_padding5')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('options_imagePaddingDesc')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
