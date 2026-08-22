import React from "react"
import { Bug, Gauge, RotateCcw, Zap } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

  const updateAdvanced = (updates: Partial<ExtensionSettings["advanced"]>) => {
    onChange({ advanced: { ...settings.advanced, ...updates } })
  }

  const imagePolicy = settings.globalPolicy.image
  const chapterPolicy = settings.globalPolicy.chapter
  const retries = settings.globalRetries

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-network-heading"
        title={t("options_network")}
        description={t("options_performanceDesc")}
      />

      {/* Group 1: Performance & Pacing */}
      <SettingsGroup
        title={t("options_performance")}
        description={t("options_performanceDesc")}
      >
        {/* Image Concurrency Slider */}
        <SettingsRow
          icon={Gauge}
          title={
            <div className="flex items-center gap-2">
              <span>{t("options_imageConcurrency")}</span>
              <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-md font-semibold">
                {t("options_streams", [String(imagePolicy.concurrency)])}
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
          htmlFor="image-concurrency-slider"
          align="start"
        />

        {/* Image Request Delay */}
        <SettingsRow
          icon={Zap}
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
                    className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-150 hover:scale-[1.02] active:scale-[0.95] cursor-pointer"
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
                className="font-mono w-28"
              />
              <span className="text-xs text-muted-foreground font-mono">
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
                      updateGlobalPolicy("chapter", { delayMs: preset.val })
                    }
                    className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-mono text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-150 hover:scale-[1.02] active:scale-[0.95] cursor-pointer"
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
                className="font-mono w-28"
              />
              <span className="text-xs text-muted-foreground font-mono">
                ms
              </span>
            </div>
          }
        />
      </SettingsGroup>

      {/* Group 2: Retry Settings */}
      <SettingsGroup
        title={t("options_retrySettings")}
        description={t("options_retrySettingsDesc")}
      >
        <SettingsRow
          icon={RotateCcw}
          title={t("options_imageRetries")}
          description={t("options_imageRetriesDesc")}
          htmlFor="image-retries"
          control={
            <Input
              id="image-retries"
              data-testid="image-retries-input"
              type="number"
              min={0}
              max={10}
              value={retries.image}
              onChange={(e) =>
                updateGlobalRetries({ image: parseInt(e.target.value) || 0 })
              }
              className="font-mono w-28"
            />
          }
        />

        <SettingsRow
          title={t("options_chapterRetries")}
          description={t("options_chapterRetriesDesc")}
          htmlFor="chapter-retries"
          control={
            <Input
              id="chapter-retries"
              data-testid="chapter-retries-input"
              type="number"
              min={0}
              max={10}
              value={retries.chapter}
              onChange={(e) =>
                updateGlobalRetries({ chapter: parseInt(e.target.value) || 0 })
              }
              className="font-mono w-28"
            />
          }
        />
      </SettingsGroup>

      {/* Group 3: Debug & Diagnostics */}
      <SettingsGroup
        title={t("options_debugSettings")}
        description={t("options_debugSettingsDesc")}
      >
        <SettingsRow
          icon={Bug}
          title={t("options_logLevel")}
          description={t("options_logLevelDesc")}
          htmlFor="log-level"
          control={
            <Select
              value={settings.advanced.logLevel}
              onValueChange={(val) =>
                updateAdvanced({
                  logLevel: val as "error" | "warn" | "info" | "debug",
                })
              }
            >
              <SelectTrigger
                id="log-level"
                data-testid="log-level-select"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">
                  {t("options_logLevelError")}
                </SelectItem>
                <SelectItem value="warn">
                  {t("options_logLevelWarn")}
                </SelectItem>
                <SelectItem value="info">
                  {t("options_logLevelInfo")}
                </SelectItem>
                <SelectItem value="debug">
                  {t("options_logLevelDebug")}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroup>
    </div>
  )
}
