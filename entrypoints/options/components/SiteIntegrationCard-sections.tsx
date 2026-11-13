import { TemplateMacros } from "./primitives/TemplateMacros"
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
import { SettingSourceLabel } from "./SettingSourceLabel"
import type { SiteIntegrationCardProps } from "./SiteIntegrationCard-types"

type OverrideSectionProps = Pick<
  SiteIntegrationCardProps,
  "siteIntegration" | "override" | "globalDefaults"
> & { updateOverride: (updates: Partial<SiteOverrideRecord>) => void }

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
        <SettingSourceLabel
          id={`${siteIntegration.id}-format`}
          label={t("options_archiveFormat")}
          source={override?.outputFormat !== undefined ? "override" : "global"}
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
            aria-describedby={`${siteIntegration.id}-format-source`}
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
        <SettingSourceLabel
          id={`${siteIntegration.id}-path`}
          label={t("options_directoryPathTemplate")}
          source={override?.pathTemplate !== undefined ? "override" : "global"}
        />
        <p
          id={`${siteIntegration.id}-path-help`}
          className="options-template-help"
        >
          {t("options_directoryPathTemplateDesc")}
        </p>
        <Input
          id={`${siteIntegration.id}-path`}
          aria-describedby={`${siteIntegration.id}-path-source ${siteIntegration.id}-path-help`}
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
          integrationId={siteIntegration.id}
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
          integrationId={siteIntegration.id}
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
      <SettingSourceLabel
        id={id}
        label={t(
          scope === "image" ? "options_imageRetries" : "options_chapterRetries"
        )}
        source={value?.[scope] !== undefined ? "override" : "global"}
      />
      <Input
        id={id}
        aria-describedby={`${id}-source`}
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
          const changeValue = (value: typeof storedValue | undefined) =>
            onChange?.(siteIntegration.id, schema.id, value)
          return (
            <CustomSettingField
              key={`${siteIntegration.id}-${schema.id}`}
              integrationId={siteIntegration.id}
              schema={schema}
              effectiveValue={
                storedValue === undefined ? schema.defaultValue : storedValue
              }
              onChange={changeValue}
              onReset={
                onChange && storedValue !== undefined
                  ? () => changeValue(undefined)
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
