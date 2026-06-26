/**
 * SiteIntegrationCard - Displays individual site integration with override controls
 */

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RateLimitingForm } from "./RateLimitingForm"
import { cn } from "@/src/shared/utils"
import type { SiteOverrideRecord } from "@/src/storage/site-overrides-service"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import type { SiteIntegrationSettingValue } from "@/src/storage/site-integration-settings-service"
import type { SettingsFieldSchema } from "@/src/site-integrations/manifest"

type CustomSettingValue = SiteIntegrationSettingValue

interface SiteIntegrationInfo {
  id: string
  name: string
  domains: string[]
  customSettings?: SettingsFieldSchema[]
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
    outputFormat: 'cbz' | 'zip' | 'none'
    imagePolicy: RateScopePolicy
    chapterPolicy: RateScopePolicy
  }
  siteIntegrationSettingsValues?: Record<string, CustomSettingValue>
  onEnabledChange?: (siteIntegrationId: string, enabled: boolean) => void
  onSiteIntegrationSettingsChange?: (siteIntegrationId: string, settingId: string, enabled: boolean, value: CustomSettingValue) => void
  onChange: (siteIntegrationId: string, override: SiteOverrideRecord | null) => void
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

  const hasOverrides = override && Object.keys(override).length > 0

  const handleReset = () => {
    onChange(siteIntegration.id, null)
    setIsExpanded(false)
  }

  const updateOverride = (updates: Partial<SiteOverrideRecord>) => {
    const newOverride = { ...(override || {}), ...updates }
    // Remove undefined values
    Object.keys(newOverride).forEach(key => {
      if (newOverride[key as keyof SiteOverrideRecord] === undefined) {
        delete newOverride[key as keyof SiteOverrideRecord]
      }
    })
    onChange(siteIntegration.id, Object.keys(newOverride).length > 0 ? newOverride : null)
  }

  const customSettings = siteIntegration.customSettings ?? []

  const getEffectiveCustomValue = (schema: SettingsFieldSchema): CustomSettingValue => {
    const value = siteIntegrationSettingsValues[schema.id]
    return value === undefined ? (schema.defaultValue as CustomSettingValue) : value
  }

  const isCustomSettingEnabled = (schema: SettingsFieldSchema): boolean => {
    return siteIntegrationSettingsValues[schema.id] !== undefined
  }

  const updateCustomSetting = (schema: SettingsFieldSchema, enabled: boolean, value: CustomSettingValue) => {
    onSiteIntegrationSettingsChange?.(siteIntegration.id, schema.id, enabled, value)
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
            : "hover:border-border",
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="gap-0 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base font-semibold">{siteIntegration.name}</CardTitle>
                {!isEnabled && (
                  <Badge variant="secondary" className="h-5 px-2 text-[10px] font-medium text-muted-foreground">
                    Disabled
                  </Badge>
                )}
                {hasOverrides && (
                  <Badge variant="outline" className="h-5 border-primary/40 bg-primary/10 px-2 text-[10px] font-medium text-foreground">
                    Override
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                {siteIntegration.domains.join(', ')}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${siteIntegration.id}-integration-enabled`} className="text-xs text-muted-foreground">Enabled</Label>
                <Switch
                  id={`${siteIntegration.id}-integration-enabled`}
                  checked={isEnabled}
                  aria-label={`Enable ${siteIntegration.name}`}
                  onCheckedChange={(checked) => onEnabledChange?.(siteIntegration.id, checked)}
                />
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  data-testid={`configure-site-integration-${siteIntegration.id}`}
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs font-medium"
                >
                  {isExpanded ? 'Hide' : 'Configure'}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent className="border-t border-border/60">
          <CardContent className="flex flex-col gap-6 px-5 py-5">
            {/* Download Settings */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Download Settings</h4>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${siteIntegration.id}-format`}>
                  Archive Format
                  {override?.outputFormat !== undefined && (
                    <Badge variant="outline" className="ml-2 text-[10px] font-medium">Override</Badge>
                  )}
                </Label>
                <Select
                  value={override?.outputFormat ?? globalDefaults.outputFormat}
                  onValueChange={(value: 'cbz' | 'zip' | 'none') => {
                    updateOverride({
                      outputFormat: value !== globalDefaults.outputFormat ? value : undefined
                    })
                  }}
                >
                  <SelectTrigger id={`${siteIntegration.id}-format`} className="font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="cbz">CBZ (Comic Book Archive)</SelectItem>
                      <SelectItem value="zip">ZIP</SelectItem>
                      <SelectItem value="none">No Archive (Individual Files)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${siteIntegration.id}-path`}>
                  Download Path Template
                  {override?.pathTemplate !== undefined && (
                    <Badge variant="outline" className="ml-2 text-[10px] font-medium">Override</Badge>
                  )}
                </Label>
                <Input
                  id={`${siteIntegration.id}-path`}
                  value={override?.pathTemplate ?? ''}
                  onChange={(e) => updateOverride({ pathTemplate: e.target.value || undefined })}
                  placeholder="Leave empty to use global path"
                />
                <p className="text-[11px] font-medium text-muted-foreground">
                  Use macros like &lt;SERIES_TITLE&gt;, &lt;CHAPTER_NUMBER&gt;
                </p>
              </div>
            </div>

            {/* Rate Limiting - Image */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Rate Limiting - Images</h4>
              <RateLimitingForm
                scope="image"
                value={override?.imagePolicy || {}}
                onChange={(value) => updateOverride({
                  imagePolicy: (value.concurrency || value.delayMs) ? value : undefined
                })}
                globalValue={globalDefaults.imagePolicy}
                siteIntegrationDefault={siteIntegration.policyDefaults?.image}
                showHierarchy={true}
              />
            </div>

            {/* Rate Limiting - Chapter */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Rate Limiting - Chapters</h4>
              <RateLimitingForm
                scope="chapter"
                value={override?.chapterPolicy || {}}
                onChange={(value) => updateOverride({
                  chapterPolicy: value.delayMs != null ? { delayMs: value.delayMs } : undefined
                })}
                globalValue={globalDefaults.chapterPolicy}
                siteIntegrationDefault={siteIntegration.policyDefaults?.chapter}
                showHierarchy={true}
                showConcurrency={false}
              />
            </div>

            {/* Retry Settings */}
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">Retry Settings</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${siteIntegration.id}-image-retries`}>Image Retries</Label>
                  <Input
                    id={`${siteIntegration.id}-image-retries`}
                    type="number"
                    min={0}
                    max={10}
                    value={override?.retries?.image ?? ''}
                    onChange={(e) => updateOverride({
                      retries: {
                        ...override?.retries,
                        image: e.target.value ? parseInt(e.target.value) : undefined
                      }
                    })}
                    placeholder="Default: 3"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${siteIntegration.id}-chapter-retries`}>Chapter Retries</Label>
                  <Input
                    id={`${siteIntegration.id}-chapter-retries`}
                    type="number"
                    min={0}
                    max={10}
                    value={override?.retries?.chapter ?? ''}
                    onChange={(e) => updateOverride({
                      retries: {
                        ...override?.retries,
                        chapter: e.target.value ? parseInt(e.target.value) : undefined
                      }
                    })}
                    placeholder="Default: 3"
                  />
                </div>
              </div>
            </div>

            {customSettings.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold">Custom settings</h4>
                <div className="flex flex-col gap-3">
                  {customSettings.map((schema) => {
                    const enabled = isCustomSettingEnabled(schema)
                    const effectiveValue = getEffectiveCustomValue(schema)
                    const textValue = typeof effectiveValue === 'string' ? effectiveValue : ''
                    const numberValue = typeof effectiveValue === 'number' ? effectiveValue : 0
                    const selectValue = typeof effectiveValue === 'string'
                      ? effectiveValue
                      : (typeof schema.defaultValue === 'string' ? schema.defaultValue : '')
                    const multiselectValues = Array.isArray(effectiveValue)
                      ? effectiveValue.filter((value): value is string => typeof value === 'string')
                      : []
                    const customSettingControlId = `${siteIntegration.id}-custom-${schema.id}`
                    const customSettingOverrideId = `${customSettingControlId}-enabled`

                    return (
                      <div
                        key={`${siteIntegration.id}-${schema.id}`}
                        className="flex flex-col gap-3 rounded-md border border-border/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={customSettingControlId} className="font-medium">
                              {schema.label}
                            </Label>
                            {schema.description && (
                              <p className="text-[11px] text-muted-foreground">{schema.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Label htmlFor={customSettingOverrideId} className="text-[11px] text-muted-foreground">Enable override</Label>
                            <Switch
                              id={customSettingOverrideId}
                              checked={enabled}
                              onCheckedChange={(checked) => {
                                updateCustomSetting(schema, checked, effectiveValue)
                              }}
                            />
                          </div>
                        </div>

                        {schema.type === 'boolean' && (
                          <Switch
                            id={customSettingControlId}
                            checked={Boolean(effectiveValue)}
                            disabled={!enabled}
                            className="data-[state=unchecked]:bg-muted-foreground/25"
                            onCheckedChange={(checked) => updateCustomSetting(schema, enabled, checked)}
                          />
                        )}

                        {schema.type === 'string' && (
                          <Input
                            id={customSettingControlId}
                            value={textValue}
                            disabled={!enabled}
                            className="font-medium"
                            onChange={(e) => updateCustomSetting(schema, enabled, e.target.value)}
                          />
                        )}

                        {schema.type === 'number' && (
                          <Input
                            id={customSettingControlId}
                            type="number"
                            value={numberValue}
                            disabled={!enabled}
                            className="font-medium"
                            onChange={(e) => updateCustomSetting(schema, enabled, Number(e.target.value))}
                          />
                        )}

                        {schema.type === 'select' && (
                          <Select
                            value={selectValue}
                            disabled={!enabled}
                            onValueChange={(nextValue) => updateCustomSetting(schema, enabled, nextValue)}
                          >
                            <SelectTrigger id={customSettingControlId} className="font-medium">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {(schema.options ?? []).map((option) => (
                                  <SelectItem key={`${schema.id}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}

                        {schema.type === 'multiselect' && schema.options && schema.options.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {schema.options.map((option) => {
                              const isChecked = multiselectValues.includes(option.value)
                              return (
                                <label
                                  key={`${schema.id}-ms-${option.value}`}
                                  className={cn(
                                    'flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm',
                                    enabled
                                      ? 'cursor-pointer hover:bg-muted/40'
                                      : 'cursor-not-allowed bg-muted/20 text-muted-foreground/70',
                                  )}
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    disabled={!enabled}
                                    onCheckedChange={() => {
                                      const nextValues = isChecked
                                        ? multiselectValues.filter((v) => v !== option.value)
                                        : [...multiselectValues, option.value]
                                      updateCustomSetting(schema, enabled, nextValues)
                                    }}
                                  />
                                  <span className="truncate">{option.label}</span>
                                </label>
                              )
                            })}
                          </div>
                        )}
                        {schema.type === 'multiselect' && (!schema.options || schema.options.length === 0) && (
                          <Input
                            id={customSettingControlId}
                            value={multiselectValues.join(', ')}
                            disabled={!enabled}
                            placeholder="Comma-separated values"
                            className="font-medium"
                            onChange={(e) => {
                              const nextValues = e.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter((value) => value.length > 0)
                              updateCustomSetting(schema, enabled, nextValues)
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
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
                  Reset to Global Defaults
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
