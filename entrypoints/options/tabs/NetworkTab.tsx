import { NumberStepper } from "../components/primitives/NumberStepper"
import { NetworkPacingPreview } from "../components/NetworkPacingPreview"
import React from "react"

import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { t } from "@/src/runtime/i18n"
import {
  clampRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"

interface NetworkTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
}

export function NetworkTab({ settings, onChange }: NetworkTabProps) {
  const updateGlobalPolicy = (
    scope: "image" | "chapter",
    policy: Partial<RateScopePolicy>
  ) => {
    onChange({
      globalPolicy: {
        ...settings.globalPolicy,
        [scope]: { ...settings.globalPolicy[scope], ...policy },
      },
    })
  }

  const updateGlobalRetries = (
    updates: Partial<ExtensionSettings["globalRetries"]>
  ) => {
    onChange({ globalRetries: { ...settings.globalRetries, ...updates } })
  }

  const imagePolicy = settings.globalPolicy.image
  const chapterPolicy = settings.globalPolicy.chapter
  const retries = settings.globalRetries

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-network-heading"
        title={t("options_network")}
      />

      {/* Group 1: Performance & Pacing */}
      <SettingsGroup title={t("options_performance")}>
        <div className="@container">
          <div className="options-pacing-layout">
            <div className="min-w-0 divide-y divide-border/70">
              {/* Image Concurrency Slider */}
              <SettingsRow
                title={
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{t("options_imageConcurrency")}</span>
                    <span className="text-xs tabular-nums text-foreground font-semibold">
                      {imagePolicy.concurrency}
                    </span>
                  </div>
                }
                description={
                  <div className="flex flex-col gap-2 mt-2">
                    <p className="text-xs text-muted-foreground">
                      {t("options_imageConcurrencyDesc")}
                    </p>
                    <Slider
                      thumbAriaLabel={t("options_imageConcurrency")}
                      id="image-concurrency-slider"
                      data-testid="image-concurrency-slider"
                      value={[imagePolicy.concurrency]}
                      min={RATE_POLICY_LIMITS.MIN_CONCURRENCY}
                      max={RATE_POLICY_LIMITS.MAX_CONCURRENCY}
                      step={1}
                      onValueChange={([value]) =>
                        updateGlobalPolicy("image", { concurrency: value })
                      }
                      className="py-2 max-w-md"
                    />
                  </div>
                }
                align="start"
              />

              {/* Image Request Delay */}
              <SettingsRow
                title={t("options_imageRequestDelay")}
                description={
                  <div className="flex flex-col gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {t("options_imageRequestDelayDesc")}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {[
                        { label: "0ms", val: 0 },
                        { label: "200ms", val: 200 },
                        { label: "500ms", val: 500 },
                        { label: "1000ms", val: 1000 },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          onClick={() =>
                            updateGlobalPolicy("image", { delayMs: preset.val })
                          }
                          aria-pressed={imagePolicy.delayMs === preset.val}
                          className="inline-flex min-h-6 cursor-pointer items-center rounded-md border bg-muted/60 px-2 tabular-nums text-xs transition-colors duration-150 hover:bg-accent aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                }
                htmlFor="image-request-delay"
                align="start"
                control={
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="image-request-delay"
                      data-testid="request-delay-input"
                      type="number"
                      min={RATE_POLICY_LIMITS.MIN_DELAY_MS}
                      max={RATE_POLICY_LIMITS.MAX_DELAY_MS}
                      step={100}
                      value={imagePolicy.delayMs}
                      onChange={(e) =>
                        updateGlobalPolicy("image", {
                          delayMs: clampRatePolicyInteger(
                            Number(e.target.value),
                            RATE_POLICY_LIMITS.MIN_DELAY_MS,
                            RATE_POLICY_LIMITS.MAX_DELAY_MS
                          ),
                        })
                      }
                      className="tabular-nums w-28"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ms
                    </span>
                  </div>
                }
              />

              {/* Chapter Delay */}
              <SettingsRow
                title={t("options_chapterDelay")}
                description={
                  <div className="flex flex-col gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">
                      {t("options_chapterDelayDesc")}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {[
                        { label: "0ms", val: 0 },
                        { label: "500ms", val: 500 },
                        { label: "1000ms", val: 1000 },
                        { label: "2000ms", val: 2000 },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          onClick={() =>
                            updateGlobalPolicy("chapter", {
                              delayMs: preset.val,
                            })
                          }
                          aria-pressed={chapterPolicy.delayMs === preset.val}
                          className="inline-flex min-h-6 cursor-pointer items-center rounded-md border bg-muted/60 px-2 tabular-nums text-xs transition-colors duration-150 hover:bg-accent aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                }
                htmlFor="chapter-delay"
                align="start"
                control={
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="chapter-delay"
                      data-testid="chapter-delay-input"
                      type="number"
                      min={RATE_POLICY_LIMITS.MIN_DELAY_MS}
                      max={RATE_POLICY_LIMITS.MAX_DELAY_MS}
                      step={100}
                      value={chapterPolicy.delayMs}
                      onChange={(e) =>
                        updateGlobalPolicy("chapter", {
                          delayMs: clampRatePolicyInteger(
                            Number(e.target.value),
                            RATE_POLICY_LIMITS.MIN_DELAY_MS,
                            RATE_POLICY_LIMITS.MAX_DELAY_MS
                          ),
                        })
                      }
                      className="tabular-nums w-28"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ms
                    </span>
                  </div>
                }
              />
            </div>
            <NetworkPacingPreview
              imageDelay={imagePolicy.delayMs}
              concurrency={imagePolicy.concurrency}
              chapterDelay={chapterPolicy.delayMs}
            />
          </div>
        </div>
      </SettingsGroup>

      {/* Group 2: Retry Settings */}
      <SettingsGroup title={t("options_retrySettings")}>
        <SettingsRow
          title={t("options_imageRetries")}

          htmlFor="image-retries"
          control={
            <NumberStepper
              id="image-retries"
              testId="image-retries-input"
              label={t("options_imageRetries")}
              min={0}
              max={10}
              value={retries.image}
              onChange={(value) => updateGlobalRetries({ image: value })}
            />
          }
        />

        <SettingsRow
          title={t("options_chapterRetries")}

          htmlFor="chapter-retries"
          control={
            <NumberStepper
              id="chapter-retries"
              testId="chapter-retries-input"
              label={t("options_chapterRetries")}
              min={0}
              max={10}
              value={retries.chapter}
              onChange={(value) => updateGlobalRetries({ chapter: value })}
            />
          }
        />
      </SettingsGroup>
    </div>
  )
}
