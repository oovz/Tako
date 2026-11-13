/** Render a typed setting defined by a site integration. */

import { Button } from "@/components/ui/button"
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
import { t } from "@/src/runtime/i18n"
import type { SiteIntegrationSettingsField as SettingsFieldSchema } from "@/src/site-integrations/definition-types"
import type { SiteIntegrationSettingValue } from "@/src/domain/site-integrations/storage-schemas"

type CustomSettingValue = SiteIntegrationSettingValue

interface CustomSettingFieldProps {
  /** Unique ID prefix for the integration (used to generate stable HTML IDs). */
  integrationId: string
  schema: SettingsFieldSchema
  effectiveValue: CustomSettingValue
  onChange: (value: CustomSettingValue) => void
  onReset?: () => void
}

export function CustomSettingField({
  integrationId,
  schema,
  effectiveValue,
  onChange,
  onReset,
}: CustomSettingFieldProps) {
  const controlId = `${integrationId}-custom-${schema.id}`
  const descriptionId = schema.descriptionKey
    ? `${controlId}-description`
    : undefined
  const labelId = `${controlId}-label`

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          {schema.type === "multiselect" ? (
            <p id={labelId} className="font-medium">
              {t(schema.labelKey)}
            </p>
          ) : (
            <Label htmlFor={controlId} id={labelId} className="font-medium">
              {t(schema.labelKey)}
            </Label>
          )}
          {schema.descriptionKey && (
            <p id={descriptionId} className="text-xs text-muted-foreground">
              {t(schema.descriptionKey)}
            </p>
          )}
        </div>
        {onReset && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-describedby={labelId}
            onClick={onReset}
          >
            {t("options_resetCustomSetting")}
          </Button>
        )}
      </div>

      <CustomSettingControl
        controlId={controlId}
        labelId={labelId}
        descriptionId={descriptionId}
        schema={schema}
        effectiveValue={effectiveValue}
        onChange={onChange}
      />
    </div>
  )
}

type SettingControlProps = Pick<
  CustomSettingFieldProps,
  "schema" | "effectiveValue" | "onChange"
> & {
  controlId: string
  labelId: string
  descriptionId?: string
}

function CustomSettingControl(props: SettingControlProps) {
  const { schema, controlId, descriptionId, effectiveValue, onChange } = props
  switch (schema.type) {
    case "boolean":
      return (
        <Switch
          id={controlId}
          aria-describedby={descriptionId}
          checked={Boolean(effectiveValue)}
          className="data-[state=unchecked]:bg-muted-foreground/25"
          onCheckedChange={onChange}
        />
      )
    case "string":
    case "number":
      return <ScalarSettingControl {...props} schema={schema} />
    case "select":
      return <SelectSettingControl {...props} schema={schema} />
    case "multiselect":
      return <MultiselectSettingControl {...props} schema={schema} />
  }
}

function ScalarSettingControl({
  schema,
  controlId,
  descriptionId,
  effectiveValue,
  onChange,
}: SettingControlProps & {
  schema: Extract<SettingsFieldSchema, { type: "string" | "number" }>
}) {
  const isNumber = schema.type === "number"
  const value = isNumber
    ? typeof effectiveValue === "number"
      ? effectiveValue
      : 0
    : typeof effectiveValue === "string"
      ? effectiveValue
      : ""
  return (
    <Input
      id={controlId}
      aria-describedby={descriptionId}
      type={isNumber ? "number" : "text"}
      value={value}
      className="font-medium"
      onChange={(event) =>
        onChange(isNumber ? Number(event.target.value) : event.target.value)
      }
    />
  )
}

function SelectSettingControl({
  schema,
  controlId,
  descriptionId,
  effectiveValue,
  onChange,
}: SettingControlProps & {
  schema: Extract<SettingsFieldSchema, { type: "select" }>
}) {
  const selectValue =
    typeof effectiveValue === "string" ? effectiveValue : schema.defaultValue
  return (
    <Select value={selectValue} onValueChange={onChange}>
      <SelectTrigger
        id={controlId}
        aria-describedby={descriptionId}
        className="font-medium"
      >
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
  )
}

function MultiselectSettingControl({
  schema,
  controlId,
  labelId,
  descriptionId,
  effectiveValue,
  onChange,
}: SettingControlProps & {
  schema: Extract<SettingsFieldSchema, { type: "multiselect" }>
}) {
  const multiselectValues = Array.isArray(effectiveValue)
    ? effectiveValue.filter(
        (value): value is string => typeof value === "string"
      )
    : []
  return (
    <fieldset
      id={controlId}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className="grid gap-2 sm:grid-cols-2"
    >
      <legend className="sr-only">{t(schema.labelKey)}</legend>
      {schema.options.map((option) => {
        const isChecked = multiselectValues.includes(option.value)
        return (
          <label
            key={`${schema.id}-ms-${option.value}`}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={() => {
                const nextValues = isChecked
                  ? multiselectValues.filter((v) => v !== option.value)
                  : [...multiselectValues, option.value]
                onChange(nextValues)
              }}
            />
            <span className="truncate">{t(option.labelKey)}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
