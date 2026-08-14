/**
 * CustomSettingField - Renders a single custom setting field within a site integration card.
 *
 * Handles all field types defined in {@link SettingsFieldSchema}: boolean, string, number,
 * select, and multiselect. The field also exposes an enable/disable override toggle so users
 * can opt-in to a non-default value on a per-integration basis.
 */

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/src/shared/utils"
import { t } from "@/src/runtime/i18n"
import type { SiteIntegrationSettingsField as SettingsFieldSchema } from "@/src/site-integrations/definition-types"
import type { SiteIntegrationSettingValue } from "@/src/domain/site-integrations/storage-schemas"

type CustomSettingValue = SiteIntegrationSettingValue

interface CustomSettingFieldProps {
  /** Unique ID prefix for the integration (used to generate stable HTML IDs). */
  integrationId: string
  schema: SettingsFieldSchema
  /** Whether this override is currently active (toggled on). */
  enabled: boolean
  /** The effective value to display (may come from the stored override or the schema default). */
  effectiveValue: CustomSettingValue
  onChange: (
    schema: SettingsFieldSchema,
    enabled: boolean,
    value: CustomSettingValue
  ) => void
}

/**
 * A single custom setting control with an "enable override" toggle. The
 * field input is disabled when `enabled` is false to signal the value is
 * not active.
 */
export function CustomSettingField({
  integrationId,
  schema,
  enabled,
  effectiveValue,
  onChange,
}: CustomSettingFieldProps) {
  const controlId = `${integrationId}-custom-${schema.id}`
  const overrideToggleId = `${controlId}-enabled`
  const descriptionId = `${controlId}-description`
  const labelId = `${controlId}-label`

  const textValue = typeof effectiveValue === "string" ? effectiveValue : ""
  const numberValue = typeof effectiveValue === "number" ? effectiveValue : 0
  const selectValue =
    typeof effectiveValue === "string"
      ? effectiveValue
      : typeof schema.defaultValue === "string"
        ? schema.defaultValue
        : ""
  const multiselectValues = Array.isArray(effectiveValue)
    ? effectiveValue.filter((v): v is string => typeof v === "string")
    : []

  return (
    <div
      key={`${integrationId}-${schema.id}`}
      className="flex flex-col gap-3 rounded-md border border-border/70 p-4"
    >
      {/* Header: label + description + enable-override toggle */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {schema.type === "multiselect" ? (
            <p id={labelId} className="font-medium">
              {t(schema.labelKey)}
            </p>
          ) : (
            <Label htmlFor={controlId} className="font-medium">
              {t(schema.labelKey)}
            </Label>
          )}
          {schema.descriptionKey && (
            <p id={descriptionId} className="text-[11px] text-muted-foreground">
              {t(schema.descriptionKey)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor={overrideToggleId}
            className="text-[11px] text-muted-foreground"
          >
            {t("options_enableOverride")}
          </Label>
          <Switch
            id={overrideToggleId}
            checked={enabled}
            onCheckedChange={(checked) =>
              onChange(schema, checked, effectiveValue)
            }
          />
        </div>
      </div>

      {/* Field control – type-specific */}
      {schema.type === "boolean" && (
        <Switch
          id={controlId}
          checked={Boolean(effectiveValue)}
          disabled={!enabled}
          className="data-[state=unchecked]:bg-muted-foreground/25"
          onCheckedChange={(checked) => onChange(schema, enabled, checked)}
        />
      )}

      {schema.type === "string" && (
        <Input
          id={controlId}
          value={textValue}
          disabled={!enabled}
          className="font-medium"
          onChange={(e) => onChange(schema, enabled, e.target.value)}
        />
      )}

      {schema.type === "number" && (
        <Input
          id={controlId}
          type="number"
          value={numberValue}
          disabled={!enabled}
          className="font-medium"
          onChange={(e) => onChange(schema, enabled, Number(e.target.value))}
        />
      )}

      {schema.type === "select" && (
        <Select
          value={selectValue}
          disabled={!enabled}
          onValueChange={(nextValue) => onChange(schema, enabled, nextValue)}
        >
          <SelectTrigger id={controlId} className="font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {schema.options.map((option) => (
                <SelectItem
                  key={`${schema.id}-${option.value}`}
                  value={option.value}
                >
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {schema.type === "multiselect" && (
        <fieldset
          id={controlId}
          aria-labelledby={labelId}
          aria-describedby={schema.descriptionKey ? descriptionId : undefined}
          className="grid gap-2 sm:grid-cols-2"
        >
          <legend className="sr-only">{t(schema.labelKey)}</legend>
          {schema.options.map((option) => {
            const isChecked = multiselectValues.includes(option.value)
            return (
              <label
                key={`${schema.id}-ms-${option.value}`}
                className={cn(
                  "flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm",
                  enabled
                    ? "cursor-pointer hover:bg-muted/40"
                    : "cursor-not-allowed bg-muted/20 text-muted-foreground/70"
                )}
              >
                <Checkbox
                  checked={isChecked}
                  disabled={!enabled}
                  onCheckedChange={() => {
                    const nextValues = isChecked
                      ? multiselectValues.filter((v) => v !== option.value)
                      : [...multiselectValues, option.value]
                    onChange(schema, enabled, nextValues)
                  }}
                />
                <span className="truncate">{t(option.labelKey)}</span>
              </label>
            )
          })}
        </fieldset>
      )}
    </div>
  )
}
