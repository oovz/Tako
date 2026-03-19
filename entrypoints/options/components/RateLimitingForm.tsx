/**
 * RateLimitingForm - Form for rate limiting policies with hierarchy visualization
 * Shows effective policy from hierarchy: site override > site integration default > global
 */

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import type { RateScopePolicy } from "@/src/types/rate-policy"

interface RateLimitingFormProps {
  scope: 'image' | 'chapter'
  value: Partial<RateScopePolicy>
  onChange: (value: Partial<RateScopePolicy>) => void
  globalValue?: RateScopePolicy
  siteIntegrationDefault?: Partial<RateScopePolicy>
  showHierarchy?: boolean
  disabled?: boolean
}

export function RateLimitingForm({
  scope,
  value,
  onChange,
  globalValue,
  siteIntegrationDefault,
  showHierarchy = false,
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
      case 'override': return <Badge variant="default" className="ml-2 text-xs">Override</Badge>
      case 'siteIntegration': return <Badge variant="secondary" className="ml-2 text-xs">Site Integration</Badge>
      case 'global': return <Badge variant="outline" className="ml-2 text-xs">Global</Badge>
      default: return null
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor={`${scope}-concurrency`}>
            {capitalizedScope} Concurrency
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
          placeholder={showHierarchy ? `Default: ${effectiveConcurrency}` : undefined}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Maximum concurrent {scope} downloads (1-10)
          {showHierarchy && value.concurrency == null && ` • Using: ${effectiveConcurrency}`}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor={`${scope}-delay`}>
            {capitalizedScope} Delay (ms)
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
          placeholder={showHierarchy ? `Default: ${effectiveDelay}` : undefined}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Minimum delay between {scope} requests (0-10000 ms)
          {showHierarchy && value.delayMs == null && ` • Using: ${effectiveDelay}ms`}
        </p>
      </div>

      {showHierarchy && (globalValue || siteIntegrationDefault) && (
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium mb-2">Policy Hierarchy:</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {value.concurrency != null || value.delayMs != null ? (
              <li>✓ <strong>Override</strong>: Active (this form)</li>
            ) : null}
            {siteIntegrationDefault && (
              <li>• <strong>Site Integration Default</strong>: {siteIntegrationDefault.concurrency} concurrent, {siteIntegrationDefault.delayMs}ms delay</li>
            )}
            {globalValue && (
              <li>• <strong>Global Default</strong>: {globalValue.concurrency} concurrent, {globalValue.delayMs}ms delay</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
