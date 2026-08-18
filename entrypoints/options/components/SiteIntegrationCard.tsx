/**
 * SiteIntegrationCard - Displays individual site integration with override controls
 */

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RateLimitingForm } from "./RateLimitingForm"
import { CustomSettingField } from "./CustomSettingField"
import { cn } from "@/src/shared/utils"
import { t } from "@/src/runtime/i18n"
import {
  normalizeImagePolicyOverride,
  normalizeRetryOverride,
} from "@/entrypoints/options/hooks/rate-policy-override"
import type {
  SiteIntegrationSettingValue,
  SiteOverrideRecord,
} from "@/src/domain/site-integrations/storage-schemas"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import type { SiteIntegrationSettingsField as SettingsFieldSchema } from "@/src/site-integrations/definition-types"

type CustomSettingValue = SiteIntegrationSettingValue

interface SiteIntegrationInfo {
  id: string
  name: string
  contributors?: readonly string[] | string[]
  domains: string[]
  customSettings?: SettingsFieldSchema[]
  requiresBroadHttpsPermission?: boolean
  policyDefaults?: {
    image?: Partial<RateScopePolicy>
    chapter?: Partial<RateScopePolicy>
  }
}

interface SiteIntegrationCardProps {
  siteIntegration: SiteIntegrationInfo
  isEnabled: boolean
  override?: SiteOverrideRecord
  globalDefaults: {
    outputFormat: "cbz" | "zip" | "none"
    imagePolicy: RateScopePolicy
    chapterPolicy: RateScopePolicy
    retries?: { image: number; chapter: number }
  }
  siteIntegrationSettingsValues?: Record<string, CustomSettingValue>
  onEnabledChange?: (
    siteIntegrationId: string,
    enabled: boolean
  ) => void | Promise<void>
  onSiteIntegrationSettingsChange?: (
    siteIntegrationId: string,
    settingId: string,
    enabled: boolean,
    value: CustomSettingValue
  ) => void
  onChange: (
    siteIntegrationId: string,
    override: SiteOverrideRecord | null
  ) => void
}

export function SiteIntegrationCard({
  siteIntegration,
  isEnabled,
  override,
  globalDefaults,
  siteIntegrationSettingsValues = {},
  onEnabledChange,
  onSiteIntegrationSettingsChange,
  onChange,
}: SiteIntegrationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasPolicyOverrides = !!override && Object.keys(override).length > 0
  const hasCustomSettingsOverrides =
    Object.keys(siteIntegrationSettingsValues).length > 0
  const hasOverrides = hasPolicyOverrides || hasCustomSettingsOverrides

  const handleReset = () => {
    onChange(siteIntegration.id, null)
    for (const schema of siteIntegration.customSettings ?? []) {
      if (siteIntegrationSettingsValues[schema.id] !== undefined) {
        onSiteIntegrationSettingsChange?.(
          siteIntegration.id,
          schema.id,
          false,
          schema.defaultValue
        )
      }
    }
    setIsExpanded(false)
  }

  const updateOverride = (updates: Partial<SiteOverrideRecord>) => {
    const newOverride = { ...(override || {}), ...updates }
    // Remove undefined values
    Object.keys(newOverride).forEach((key) => {
      if (newOverride[key as keyof SiteOverrideRecord] === undefined) {
        delete newOverride[key as keyof SiteOverrideRecord]
      }
    })
    onChange(
      siteIntegration.id,
      Object.keys(newOverride).length > 0 ? newOverride : null
    )
  }

  const customSettings = siteIntegration.customSettings ?? []

  const getEffectiveCustomValue = (
    schema: SettingsFieldSchema
  ): CustomSettingValue => {
    const value = siteIntegrationSettingsValues[schema.id]
    return value === undefined ? schema.defaultValue : value
  }

  const isCustomSettingEnabled = (schema: SettingsFieldSchema): boolean => {
    return siteIntegrationSettingsValues[schema.id] !== undefined
  }

  const updateCustomSetting = (
    schema: SettingsFieldSchema,
    enabled: boolean,
    value: CustomSettingValue
  ) => {
    onSiteIntegrationSettingsChange?.(
      siteIntegration.id,
      schema.id,
      enabled,
      value
    )
  }

  return (
    <Card
      data-testid={`site-integration-card-${siteIntegration.id}`}
      className={cn(
        "overflow-hidden border-border/70 transition-colors duration-150",
        !isEnabled
          ? "bg-muted/15"
          : hasOverrides
            ? "border-primary/30 bg-primary/5"
            : "hover:border-border"
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="gap-0 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle
                  role="heading"
                  aria-level={2}
                  className="text-base font-semibold"
                >
                  {siteIntegration.name}
                </CardTitle>
                {!isEnabled && (
                  <Badge
                    variant="secondary"
                    className="h-5 px-2 text-[10px] font-medium text-muted-foreground"
                  >
                    {t("options_disabled")}
                  </Badge>
                )}
                {hasOverrides && (
                  <Badge
                    variant="outline"
                    className="h-5 border-primary/40 bg-primary/10 px-2 text-[10px] font-medium text-foreground"
                  >
                    {t("options_override")}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                {siteIntegration.domains.join(", ")}
              </CardDescription>
              {siteIntegration.contributors &&
                siteIntegration.contributors.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {siteIntegration.contributors.length === 1
                      ? t("options_contributor", [
                          siteIntegration.contributors[0],
                        ])
                      : t("options_contributors", [
                          siteIntegration.contributors.join(", "),
                        ])}
                  </p>
                )}
              {siteIntegration.requiresBroadHttpsPermission && !isEnabled && (
                <p className="max-w-xl text-xs text-muted-foreground">
                  {t("options_broadHostPermissionDescription", [
                    siteIntegration.name,
                  ])}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`${siteIntegration.id}-integration-enabled`}
                  className="text-xs text-muted-foreground"
                >
                  {t("options_enabled")}
                </Label>
                <Switch
                  id={`${siteIntegration.id}-integration-enabled`}
                  checked={isEnabled}
                  aria-label={t("options_enableIntegration", [
                    siteIntegration.name,
                  ])}
                  onCheckedChange={(checked) =>
                    onEnabledChange?.(siteIntegration.id, checked)
                  }
                />
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  data-testid={`configure-site-integration-${siteIntegration.id}`}
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs font-medium"
                >
                  {isExpanded ? t("options_hide") : t("options_configure")}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent className="border-t border-border/60">
          <CardContent className="flex flex-col gap-6 px-5 py-5">
            {/* Download Settings */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">
                {t("options_downloadSettings")}
              </h4>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${siteIntegration.id}-format`}>
                  {t("options_archiveFormat")}
                  {override?.outputFormat !== undefined && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-[10px] font-medium"
                    >
                      {t("options_override")}
                    </Badge>
                  )}
                </Label>
                <Select
                  value={override?.outputFormat ?? globalDefaults.outputFormat}
                  onValueChange={(value: "cbz" | "zip" | "none") => {
                    updateOverride({
                      outputFormat:
                        value !== globalDefaults.outputFormat
                          ? value
                          : undefined,
                    })
                  }}
                >
                  <SelectTrigger
                    id={`${siteIntegration.id}-format`}
                    className="font-medium"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="cbz">
                        {t("options_cbzFull")}
                      </SelectItem>
                      <SelectItem value="zip">{t("options_zip")}</SelectItem>
                      <SelectItem value="none">
                        {t("options_noArchiveFull")}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${siteIntegration.id}-path`}>
                  {t("options_downloadPathTemplate")}
                  {override?.pathTemplate !== undefined && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-[10px] font-medium"
                    >
                      {t("options_override")}
                    </Badge>
                  )}
                </Label>
                <Input
                  id={`${siteIntegration.id}-path`}
                  value={override?.pathTemplate ?? ""}
                  onChange={(e) =>
                    updateOverride({
                      pathTemplate: e.target.value || undefined,
                    })
                  }
                  placeholder={t("options_leaveEmptyGlobal")}
                />
                <p className="text-[11px] font-medium text-muted-foreground">
                  {t("options_useMacros")}
                </p>
              </div>
            </div>

            {/* Rate Limiting - Image */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">
                {t("options_rateLimitingImages")}
              </h4>
              <RateLimitingForm
                scope="image"
                value={override?.imagePolicy || {}}
                onChange={(value) =>
                  updateOverride({
                    imagePolicy: normalizeImagePolicyOverride(value),
                  })
                }
                globalValue={globalDefaults.imagePolicy}
                siteIntegrationDefault={siteIntegration.policyDefaults?.image}
                showHierarchy={true}
              />
            </div>

            {/* Rate Limiting - Chapter */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">
                {t("options_rateLimitingChapters")}
              </h4>
              <RateLimitingForm
                scope="chapter"
                value={override?.chapterPolicy || {}}
                onChange={(value) =>
                  updateOverride({
                    chapterPolicy:
                      value.delayMs != null
                        ? { delayMs: value.delayMs }
                        : undefined,
                  })
                }
                globalValue={globalDefaults.chapterPolicy}
                siteIntegrationDefault={siteIntegration.policyDefaults?.chapter}
                showHierarchy={true}
                showConcurrency={false}
              />
            </div>

            {/* Retry Settings */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">
                {t("options_retrySettings")}
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${siteIntegration.id}-image-retries`}>
                    {t("options_imageRetries")}
                  </Label>
                  <Input
                    id={`${siteIntegration.id}-image-retries`}
                    type="number"
                    min={0}
                    max={10}
                    value={override?.retries?.image ?? ""}
                    onChange={(e) =>
                      updateOverride({
                        retries: normalizeRetryOverride({
                          ...override?.retries,
                          image: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        }),
                      })
                    }
                    placeholder={
                      globalDefaults.retries
                        ? String(globalDefaults.retries.image)
                        : undefined
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${siteIntegration.id}-chapter-retries`}>
                    {t("options_chapterRetries")}
                  </Label>
                  <Input
                    id={`${siteIntegration.id}-chapter-retries`}
                    type="number"
                    min={0}
                    max={10}
                    value={override?.retries?.chapter ?? ""}
                    onChange={(e) =>
                      updateOverride({
                        retries: normalizeRetryOverride({
                          ...override?.retries,
                          chapter: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        }),
                      })
                    }
                    placeholder={
                      globalDefaults.retries
                        ? String(globalDefaults.retries.chapter)
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>

            {customSettings.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold">
                  {t("options_customSettings")}
                </h4>
                <div className="flex flex-col gap-3">
                  {customSettings.map((schema) => (
                    <CustomSettingField
                      key={`${siteIntegration.id}-${schema.id}`}
                      integrationId={siteIntegration.id}
                      schema={schema}
                      enabled={isCustomSettingEnabled(schema)}
                      effectiveValue={getEffectiveCustomValue(schema)}
                      onChange={updateCustomSetting}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Reset Button */}
            {hasOverrides && (
              <div className="border-t border-border/70 pt-2">
                <Button
                  data-testid={`reset-site-integration-overrides-${siteIntegration.id}`}
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="w-full"
                >
                  {t("options_resetToGlobalDefaults")}
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
