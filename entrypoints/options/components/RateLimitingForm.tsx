/**
 * RateLimitingForm - Form for rate limiting policies with hierarchy visualization
 * Shows effective policy from hierarchy: site override > site integration default > global
 */

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { t } from '@/src/shared/i18n'

interface RateLimitingFormProps {
  scope: 'image' | 'chapter'
  value: Partial<RateScopePolicy>
  onChange: (value: Partial<RateScopePolicy>) => void
  globalValue?: RateScopePolicy
  siteIntegrationDefault?: Partial<RateScopePolicy>
  showHierarchy?: boolean
  showConcurrency?: boolean
  disabled?: boolean
}

export function RateLimitingForm({
  scope,
  value,
  onChange,
  globalValue,
  siteIntegrationDefault,
  showHierarchy = false,
  showConcurrency = true,
  disabled = false
}: RateLimitingFormProps) {
  const capitalizedScope = scope.charAt(0).toUpperCase() + scope.slice(1)

  // Calculate effective values from hierarchy
  const effectiveConcurrency = value.concurrency ?? siteIntegrationDefault?.concurrency ?? globalValue?.concurrency ?? 2
  const effectiveDelay = value.delayMs ?? siteIntegrationDefault?.delayMs ?? globalValue?.delayMs ?? 500

  // Determine source of each value for hierarchy display
  const concurrencySource = value.concurrency != null ? 'override' :
    siteIntegrationDefault?.concurrency != null ? 'siteIntegration' : 'global'
  const delaySource = value.delayMs != null ? 'override' :
    siteIntegrationDefault?.delayMs != null ? 'siteIntegration' : 'global'

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'override': return <Badge variant="default" className="ml-2 text-xs">{t('options_override')}</Badge>
      case 'siteIntegration': return <Badge variant="secondary" className="ml-2 text-xs">{t('options_siteIntegrationBadge')}</Badge>
      case 'global': return <Badge variant="outline" className="ml-2 text-xs">{t('options_global')}</Badge>
      default: return null
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {showConcurrency && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center">
            <Label htmlFor={`${scope}-concurrency`}>
              {t('options_concurrencyLabel', [capitalizedScope])}
            </Label>
            {showHierarchy && getSourceBadge(concurrencySource)}
          </div>
          <Input
            id={`${scope}-concurrency`}
            type="number"
            min={1}
            max={10}
            value={value.concurrency ?? ''}
            onChange={(e) => onChange({
              ...value,
              concurrency: e.target.value ? parseInt(e.target.value) : undefined
            })}
            placeholder={showHierarchy ? t('options_defaultValue', [String(effectiveConcurrency)]) : undefined}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {t('options_maxConcurrencyDesc', [scope])}
            {showHierarchy && value.concurrency == null && t('options_usingValue', [String(effectiveConcurrency)])}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <Label htmlFor={`${scope}-delay`}>
            {t('options_delayLabel', [capitalizedScope])}
          </Label>
          {showHierarchy && getSourceBadge(delaySource)}
        </div>
        <Input
          id={`${scope}-delay`}
          type="number"
          min={0}
          max={10000}
          step={100}
          value={value.delayMs ?? ''}
          onChange={(e) => onChange({
            ...value,
            delayMs: e.target.value ? parseInt(e.target.value) : undefined
          })}
          placeholder={showHierarchy ? t('options_defaultValue', [String(effectiveDelay)]) : undefined}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {t('options_minDelayDesc', [scope])}
          {showHierarchy && value.delayMs == null && t('options_usingMs', [String(effectiveDelay)])}
        </p>
      </div>

      {showHierarchy && (globalValue || siteIntegrationDefault) && (
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium mb-2">{t('options_policyHierarchy')}</p>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {value.concurrency != null || value.delayMs != null ? (
              <li>✓ <strong>{t('options_override')}</strong>: {t('options_activeThisForm')}</li>
            ) : null}
            {siteIntegrationDefault && (
              <li>
                • <strong>{t('options_siteIntegrationDefault')}</strong>: {showConcurrency ? t('options_concurrentDelay', [String(siteIntegrationDefault.concurrency), String(siteIntegrationDefault.delayMs)]) : t('options_msDelay', [String(siteIntegrationDefault.delayMs)])}
              </li>
            )}
            {globalValue && (
              <li>
                • <strong>{t('options_globalDefault')}</strong>: {showConcurrency ? t('options_concurrentDelay', [String(globalValue.concurrency), String(globalValue.delayMs)]) : t('options_msDelay', [String(globalValue.delayMs)])}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
