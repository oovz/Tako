import { Zap } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { t } from "@/src/runtime/i18n"
import {
  clampRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"

interface GlobalPerformanceSectionProps {
  chapterPolicy: RateScopePolicy
  imagePolicy: RateScopePolicy
  onChapterPolicyChange: (policy: Partial<RateScopePolicy>) => void
  onImagePolicyChange: (policy: Partial<RateScopePolicy>) => void
}

export function GlobalPerformanceSection({
  chapterPolicy,
  imagePolicy,
  onChapterPolicyChange,
  onImagePolicyChange,
}: GlobalPerformanceSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-muted-foreground" />
          <CardTitle role="heading" aria-level={2} className="text-base">
            {t("options_performance")}
          </CardTitle>
        </div>
        <CardDescription>{t("options_performanceDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <Label htmlFor="image-concurrency-slider">
                {t("options_imageConcurrency")}
              </Label>
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground font-medium">
                {t("options_streams", [String(imagePolicy.concurrency)])}
              </span>
            </div>
            <Slider
              thumbAriaLabel={t("options_imageConcurrency")}
              id="image-concurrency-slider"
              data-testid="image-concurrency-slider"
              value={[imagePolicy.concurrency]}
              min={RATE_POLICY_LIMITS.MIN_CONCURRENCY}
              max={RATE_POLICY_LIMITS.MAX_CONCURRENCY}
              step={1}
              onValueChange={([value]) =>
                onImagePolicyChange({ concurrency: value })
              }
              className="py-4"
            />
            <p className="text-xs text-muted-foreground">
              {t("options_imageConcurrencyDesc")}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Label htmlFor="image-request-delay">
              {t("options_imageRequestDelay")}
            </Label>
            <Input
              id="image-request-delay"
              data-testid="request-delay-input"
              type="number"
              min={RATE_POLICY_LIMITS.MIN_DELAY_MS}
              max={RATE_POLICY_LIMITS.MAX_DELAY_MS}
              step={100}
              value={imagePolicy.delayMs}
              onChange={(e) =>
                onImagePolicyChange({
                  delayMs: clampRatePolicyInteger(
                    Number(e.target.value),
                    RATE_POLICY_LIMITS.MIN_DELAY_MS,
                    RATE_POLICY_LIMITS.MAX_DELAY_MS
                  ),
                })
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t("options_imageRequestDelayDesc")}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Label htmlFor="chapter-delay">{t("options_chapterDelay")}</Label>
            <Input
              id="chapter-delay"
              data-testid="chapter-delay-input"
              type="number"
              min={RATE_POLICY_LIMITS.MIN_DELAY_MS}
              max={RATE_POLICY_LIMITS.MAX_DELAY_MS}
              step={100}
              value={chapterPolicy.delayMs}
              onChange={(e) =>
                onChapterPolicyChange({
                  delayMs: clampRatePolicyInteger(
                    Number(e.target.value),
                    RATE_POLICY_LIMITS.MIN_DELAY_MS,
                    RATE_POLICY_LIMITS.MAX_DELAY_MS
                  ),
                })
              }
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {t("options_chapterDelayDesc")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
