import { Zap } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import type { ExtensionSettings } from '@/src/storage/settings-types'
import type { RateScopePolicy } from '@/src/types/rate-policy'

interface GlobalPerformanceSectionProps {
  downloads: ExtensionSettings['downloads']
  imagePolicy: RateScopePolicy
  onDownloadsChange: (updates: Partial<ExtensionSettings['downloads']>) => void
  onImagePolicyChange: (policy: Partial<RateScopePolicy>) => void
}

export function GlobalPerformanceSection({ downloads, imagePolicy, onDownloadsChange, onImagePolicyChange }: GlobalPerformanceSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">Performance</CardTitle>
        </div>
        <CardDescription>Control download speed and concurrency limits.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Concurrent Chapters</Label>
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground font-medium">
                {downloads.maxConcurrentChapters} tasks
              </span>
            </div>
            <Slider
              data-testid="concurrent-chapters-slider"
              value={[downloads.maxConcurrentChapters]}
              min={1}
              max={10}
              step={1}
              onValueChange={([value]) => onDownloadsChange({ maxConcurrentChapters: value })}
              className="py-4"
            />
            <p className="text-xs text-muted-foreground">
              Simultaneous chapter downloads.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Image Concurrency</Label>
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground font-medium">
                {imagePolicy.concurrency} streams
              </span>
            </div>
            <Slider
              data-testid="image-concurrency-slider"
              value={[imagePolicy.concurrency]}
              min={1}
              max={10}
              step={1}
              onValueChange={([value]) => onImagePolicyChange({ concurrency: value })}
              className="py-4"
            />
            <p className="text-xs text-muted-foreground">
              Parallel image requests per chapter.
            </p>
          </div>

          <div className="space-y-4">
            <Label>Request Delay (ms)</Label>
            <Input
              data-testid="request-delay-input"
              type="number"
              min={0}
              max={5000}
              step={100}
              value={imagePolicy.delayMs}
              onChange={(e) => onImagePolicyChange({ delayMs: parseInt(e.target.value) || 0 })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Wait time between image requests.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
