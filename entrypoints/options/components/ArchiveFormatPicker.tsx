import { AlertTriangle, CheckCircle2, FileArchive, Files, FileType } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

interface ArchiveFormatPickerProps {
  showNoArchiveWarning: boolean
  value: 'cbz' | 'zip' | 'none'
  onValueChange: (value: 'cbz' | 'zip' | 'none') => void
}

export function ArchiveFormatPicker({ showNoArchiveWarning, value, onValueChange }: ArchiveFormatPickerProps) {
  return (
    <div className="space-y-3">
      <Label className="text-base font-medium">Archive Format</Label>
      <RadioGroup
        data-testid="archive-format-radiogroup"
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue as 'cbz' | 'zip' | 'none')}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <div>
          <RadioGroupItem value="cbz" id="format-cbz" className="peer sr-only" />
          <Label
            htmlFor="format-cbz"
            className="flex flex-col justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all h-full"
          >
            <div className="flex items-center justify-between mb-2">
              <FileType className="h-4 w-4 text-muted-foreground" />
              <CheckCircle2 className="h-4 w-4 opacity-0 peer-data-[state=checked]:opacity-100 text-primary" />
            </div>
            <div className="space-y-1">
              <div className="font-medium leading-none">CBZ Archive</div>
              <div className="text-xs text-muted-foreground">Best for comic readers</div>
            </div>
          </Label>
        </div>

        <div>
          <RadioGroupItem value="zip" id="format-zip" className="peer sr-only" />
          <Label
            htmlFor="format-zip"
            className="flex flex-col justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all h-full"
          >
            <div className="flex items-center justify-between mb-2">
              <FileArchive className="h-4 w-4 text-muted-foreground" />
              <CheckCircle2 className="h-4 w-4 opacity-0 peer-data-[state=checked]:opacity-100 text-primary" />
            </div>
            <div className="space-y-1">
              <div className="font-medium leading-none">ZIP Archive</div>
              <div className="text-xs text-muted-foreground">Standard compressed folder</div>
            </div>
          </Label>
        </div>

        <div>
          <RadioGroupItem value="none" id="format-none" className="peer sr-only" />
          <Label
            htmlFor="format-none"
            className="flex flex-col justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all h-full"
          >
            <div className="flex items-center justify-between mb-2">
              <Files className="h-4 w-4 text-muted-foreground" />
              <CheckCircle2 className="h-4 w-4 opacity-0 peer-data-[state=checked]:opacity-100 text-primary" />
            </div>
            <div className="space-y-1">
              <div className="font-medium leading-none">No Archive</div>
              <div className="text-xs text-muted-foreground">Individual image files</div>
            </div>
          </Label>
        </div>
      </RadioGroup>

      {showNoArchiveWarning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/40 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">No archive + default downloads can clutter the download shelf</p>
              <p className="text-xs text-amber-900/90">
                Using &quot;No archive&quot; format with the default download location will create a separate Chrome download entry for every image. Consider enabling a custom download folder to avoid download shelf clutter.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
