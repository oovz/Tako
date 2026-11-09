import { TemplateMacros } from "./primitives/TemplateMacros"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/src/runtime/i18n"
import {
  normalizeImagePolicyOverride,
  normalizeRetryOverride,
} from "@/entrypoints/options/hooks/rate-policy-override"
import type { SiteOverrideRecord } from "@/src/domain/site-integrations/storage-schemas"
import { RateLimitingForm } from "./RateLimitingForm"
import { CustomSettingField } from "./CustomSettingField"
import type { SiteIntegrationCardProps } from "./SiteIntegrationCard-types"

type OverrideSectionProps = Pick<
  SiteIntegrationCardProps,
  "siteIntegration" | "override" | "globalDefaults"
> & { updateOverride: (updates: Partial<SiteOverrideRecord>) => void }

function OverrideLabel({
  id,
  label,
  overridden,
}: {
  id: string
  label: string
  overridden: boolean
}) {
  return (
    <Label htmlFor={id}>
      {t(label)}
      {overridden && (
        <Badge variant="outline" className="ml-2 text-xs font-medium">
          {t("options_override")}
        </Badge>
      )}
    </Label>
  )
}

export function SiteIntegrationOutputSettings({
  siteIntegration,
  override,
  globalDefaults,
  updateOverride,
}: OverrideSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{t("options_downloadSettings")}</h4>
      <div className="flex flex-col gap-2">
        <OverrideLabel
          id={`${siteIntegration.id}-format`}
          label="options_archiveFormat"
          overridden={override?.outputFormat !== undefined}
        />
        <Select
          value={override?.outputFormat ?? globalDefaults.outputFormat}
          onValueChange={(value: "cbz" | "zip" | "none") => {
            updateOverride({
              outputFormat:
                value !== globalDefaults.outputFormat ? value : undefined,
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
              <SelectItem value="cbz">{t("options_cbzFull")}</SelectItem>
              <SelectItem value="zip">{t("options_zip")}</SelectItem>
              <SelectItem value="none">{t("options_noArchiveFull")}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <OverrideLabel
          id={`${siteIntegration.id}-path`}
          label="options_directoryPathTemplate"
          overridden={override?.pathTemplate !== undefined}
        />
        <p
          id={`${siteIntegration.id}-path-help`}
          className="options-template-help"
        >
          {t("options_directoryPathTemplateDesc")}
        </p>
        <Input
          id={`${siteIntegration.id}-path`}
          aria-describedby={`${siteIntegration.id}-path-help`}
          value={override?.pathTemplate ?? ""}
          onChange={(e) =>
            updateOverride({
              pathTemplate: e.target.value || undefined,
            })
          }
          placeholder={t("options_leaveEmptyGlobal")}
        />
        <TemplateMacros
          kind="path"
          value={override?.pathTemplate ?? ""}
          onChange={(pathTemplate) =>
            updateOverride({ pathTemplate: pathTemplate || undefined })
          }
        />
      </div>
    </div>
  )
}

export function SiteIntegrationRateSettings({
  siteIntegration,
  override,
  globalDefaults,
  updateOverride,
}: OverrideSectionProps) {
  return (
    <>
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
                value.delayMs != null ? { delayMs: value.delayMs } : undefined,
            })
          }
          globalValue={globalDefaults.chapterPolicy}
          siteIntegrationDefault={siteIntegration.policyDefaults?.chapter}
          showHierarchy={true}
          showConcurrency={false}
        />
      </div>
    </>
  )
}

function RetryField({
  scope,
  integrationId,
  value,
  globalValue,
  updateOverride,
}: {
  scope: "image" | "chapter"
  integrationId: string
  value: SiteOverrideRecord["retries"]
  globalValue: SiteOverrideRecord["retries"]
  updateOverride: OverrideSectionProps["updateOverride"]
}) {
  const id = `${integrationId}-${scope}-retries`
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {t(
          scope === "image" ? "options_imageRetries" : "options_chapterRetries"
        )}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={10}
        value={value?.[scope] ?? ""}
        onChange={(event) =>
          updateOverride({
            retries: normalizeRetryOverride({
              ...value,
              [scope]: event.target.value
                ? parseInt(event.target.value)
                : undefined,
            }),
          })
        }
        placeholder={globalValue ? String(globalValue[scope]) : undefined}
      />
    </div>
  )
}

export function SiteIntegrationRetrySettings({
  siteIntegration,
  override,
  globalDefaults,
  updateOverride,
}: OverrideSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{t("options_retrySettings")}</h4>
      <div className="grid grid-cols-2 gap-4">
        <RetryField
          scope="image"
          integrationId={siteIntegration.id}
          value={override?.retries}
          globalValue={globalDefaults.retries}
          updateOverride={updateOverride}
        />
        <RetryField
          scope="chapter"
          integrationId={siteIntegration.id}
          value={override?.retries}
          globalValue={globalDefaults.retries}
          updateOverride={updateOverride}
        />
      </div>
    </div>
  )
}

export function SiteIntegrationCustomSettings({
  siteIntegration,
  values = {},
  onChange,
}: {
  siteIntegration: SiteIntegrationCardProps["siteIntegration"]
  values: SiteIntegrationCardProps["siteIntegrationSettingsValues"]
  onChange: SiteIntegrationCardProps["onSiteIntegrationSettingsChange"]
}) {
  const customSettings = siteIntegration.customSettings ?? []
  if (customSettings.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{t("options_customSettings")}</h4>
      <div className="flex flex-col gap-3">
        {customSettings.map((schema) => {
          const storedValue = values[schema.id]
          return (
            <CustomSettingField
              key={`${siteIntegration.id}-${schema.id}`}
              integrationId={siteIntegration.id}
              schema={schema}
              enabled={storedValue !== undefined}
              effectiveValue={
                storedValue === undefined ? schema.defaultValue : storedValue
              }
              onChange={(schema, enabled, value) =>
                onChange?.(siteIntegration.id, schema.id, enabled, value)
              }
            />
          )
        })}
      </div>
    </div>
  )
}
