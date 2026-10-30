/** Rate policy inputs and the hierarchy that supplies inherited values. */

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import type { RateScopePolicy } from "@/src/types/rate-policy"
import { t } from "@/src/runtime/i18n"
import {
  parseOptionalRatePolicyInteger,
  RATE_POLICY_LIMITS,
} from "@/src/shared/rate-policy-limits"
import {
  resolveRatePolicyField,
  type RatePolicySource,
} from "./RateLimitingForm-policy"

interface RateLimitingFormProps {
  scope: "image" | "chapter"
  value: Partial<RateScopePolicy>
  onChange: (value: Partial<RateScopePolicy>) => void
  globalValue?: RateScopePolicy
  siteIntegrationDefault?: Partial<RateScopePolicy>
  showHierarchy?: boolean
  showConcurrency?: boolean
  disabled?: boolean
}

const POLICY_FIELDS = {
  concurrency: {
    id: "concurrency",
    label: "options_concurrencyLabel",
    description: "options_maxConcurrentDesc",
    inherited: "options_usingValue",
    minimum: RATE_POLICY_LIMITS.MIN_CONCURRENCY,
    maximum: RATE_POLICY_LIMITS.MAX_CONCURRENCY,
    fallback: 2,
    step: undefined,
  },
  delayMs: {
    id: "delay",
    label: "options_delayLabel",
    description: "options_minDelayDesc",
    inherited: "options_usingMs",
    minimum: RATE_POLICY_LIMITS.MIN_DELAY_MS,
    maximum: RATE_POLICY_LIMITS.MAX_DELAY_MS,
    fallback: 500,
    step: 100,
  },
} as const

const SOURCE_BADGES = {
  override: { variant: "default", label: "options_override" },
  siteIntegration: {
    variant: "secondary",
    label: "options_siteIntegrationBadge",
  },
  global: { variant: "outline", label: "options_global" },
} as const

function PolicySourceBadge({ source }: { source: RatePolicySource }) {
  const badge = SOURCE_BADGES[source]
  return (
    <Badge variant={badge.variant} className="ml-2 text-xs">
      {t(badge.label)}
    </Badge>
  )
}

function NumericPolicyField({
  field,
  scope,
  value,
  onChange,
  globalValue,
  siteIntegrationDefault,
  showHierarchy,
  disabled,
}: RateLimitingFormProps & { field: keyof RateScopePolicy }) {
  const definition = POLICY_FIELDS[field]
  const effective = resolveRatePolicyField(
    value[field],
    siteIntegrationDefault?.[field],
    globalValue?.[field],
    definition.fallback
  )
  const localizedScope =
    scope === "image" ? t("options_images") : t("options_chapter")
  const id = `${scope}-${definition.id}`
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Label htmlFor={id}>{t(definition.label, [localizedScope])}</Label>
        {showHierarchy && <PolicySourceBadge source={effective.source} />}
      </div>
      <Input
        id={id}
        type="number"
        min={definition.minimum}
        max={definition.maximum}
        step={definition.step}
        value={value[field] ?? ""}
        onChange={(event) =>
          onChange({
            ...value,
            [field]: parseOptionalRatePolicyInteger(
              event.target.value,
              definition.minimum,
              definition.maximum
            ),
          })
        }
        placeholder={
          showHierarchy
            ? t("options_defaultValue", [String(effective.value)])
            : undefined
        }
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        {t(definition.description, [localizedScope])}
        {showHierarchy &&
          value[field] == null &&
          t(definition.inherited, [String(effective.value)])}
      </p>
    </div>
  )
}

function PolicyHierarchyRow({
  label,
  policy,
  showConcurrency,
}: {
  label: string
  policy: Partial<RateScopePolicy>
  showConcurrency: boolean
}) {
  const description = showConcurrency
    ? t("options_concurrentDelay", [
        String(policy.concurrency),
        String(policy.delayMs),
      ])
    : t("options_msDelay", [String(policy.delayMs)])
  return (
    <li>
      • <strong>{t(label)}</strong>: {description}
    </li>
  )
}

function PolicyHierarchy({
  value,
  siteIntegrationDefault,
  globalValue,
  showConcurrency,
}: {
  value: Partial<RateScopePolicy>
  siteIntegrationDefault?: Partial<RateScopePolicy>
  globalValue?: RateScopePolicy
  showConcurrency: boolean
}) {
  if (!globalValue && !siteIntegrationDefault) return null
  const hasOverride = value.concurrency != null || value.delayMs != null
  return (
    <div className="rounded-md bg-muted p-3 text-sm">
      <p className="font-medium mb-2">{t("options_policyHierarchy")}</p>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {hasOverride && (
          <li>
            ✓ <strong>{t("options_override")}</strong>:{" "}
            {t("options_activeThisForm")}
          </li>
        )}
        {siteIntegrationDefault && (
          <PolicyHierarchyRow
            label="options_siteIntegrationDefault"
            policy={siteIntegrationDefault}
            showConcurrency={showConcurrency}
          />
        )}
        {globalValue && (
          <PolicyHierarchyRow
            label="options_globalDefault"
            policy={globalValue}
            showConcurrency={showConcurrency}
          />
        )}
      </ul>
    </div>
  )
}

export function RateLimitingForm({
  showHierarchy = false,
  showConcurrency = true,
  disabled = false,
  ...props
}: RateLimitingFormProps) {
  const fieldProps = { ...props, showHierarchy, disabled }
  return (
    <div className="flex flex-col gap-4">
      {showConcurrency && (
        <NumericPolicyField {...fieldProps} field="concurrency" />
      )}
      <NumericPolicyField {...fieldProps} field="delayMs" />
      {showHierarchy && (
        <PolicyHierarchy {...props} showConcurrency={showConcurrency} />
      )}
    </div>
  )
}
