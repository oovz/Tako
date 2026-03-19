import { RotateCcw } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ExtensionSettings } from '@/src/storage/settings-types'

interface GlobalRetrySectionProps {
  retries: ExtensionSettings['globalRetries']
  onChange: (updates: Partial<ExtensionSettings['globalRetries']>) => void
}

export function GlobalRetrySection({ retries, onChange }: GlobalRetrySectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <RotateCcw className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">Retry Settings</CardTitle>
        </div>
        <CardDescription>Configure automatic retry behavior for failed downloads.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Label htmlFor="image-retries">Image Retries</Label>
            <Input
              id="image-retries"
              data-testid="image-retries-input"
              type="number"
              min={0}
              max={10}
              value={retries.image}
              onChange={(e) => onChange({ image: parseInt(e.target.value) || 0 })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Number of retry attempts for failed image downloads.
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="chapter-retries">Chapter Retries</Label>
            <Input
              id="chapter-retries"
              data-testid="chapter-retries-input"
              type="number"
              min={0}
              max={10}
              value={retries.chapter}
              onChange={(e) => onChange({ chapter: parseInt(e.target.value) || 0 })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Number of retry attempts for failed chapter downloads.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
