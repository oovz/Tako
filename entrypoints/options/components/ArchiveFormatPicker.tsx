import { useOptionsIndicator } from "../hooks/useOptionsMotion"
import { AlertTriangle, FileArchive, Archive, Images } from "lucide-react"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { t } from "@/src/runtime/i18n"
import { SettingsGroup } from "./primitives/SettingsGroup"

interface ArchiveFormatPickerProps {
  showNoArchiveWarning: boolean
  value: "cbz" | "zip" | "none"
  onValueChange: (value: "cbz" | "zip" | "none") => void
}

const archiveOptions = [
  {
    format: "cbz",
    label: "options_cbzArchive",
    description: "options_cbzArchiveDesc",
  },
  {
    format: "zip",
    label: "options_zipArchive",
    description: "options_zipArchiveDesc",
  },
  {
    format: "none",
    label: "options_noArchive",
    description: "options_noArchiveDesc",
  },
] as const

export function ArchiveFormatPicker({
  showNoArchiveWarning,
  value,
  onValueChange,
}: ArchiveFormatPickerProps) {
  const label = t("options_archiveFormat")
  const group = useOptionsIndicator<HTMLDivElement>(
    value,
    'label[data-selected="true"]'
  )
  const selected = archiveOptions.find((option) => option.format === value)!
  const icons = { cbz: FileArchive, zip: Archive, none: Images }
  return (
    <SettingsGroup title={label}>
      <RadioGroup
        ref={group}
        aria-label={label}
        data-testid="archive-format-radiogroup"
        value={value}
        onValueChange={(nextValue) =>
          onValueChange(nextValue as ArchiveFormatPickerProps["value"])
        }
        className="options-format-grid"
      >
        <span className="options-indicator" aria-hidden="true" />
        {archiveOptions.map((option) => {
          const Icon = icons[option.format]
          return (
            <div key={option.format} className="options-format-cell">
              <RadioGroupItem
                className="sr-only"
                value={option.format}
                id={`format-${option.format}`}
              />
              <Label
                htmlFor={`format-${option.format}`}
                data-selected={value === option.format}
                className="options-format-option"
              >
                <Icon aria-hidden="true" />
                <span>{t(option.label)}</span>
              </Label>
            </div>
          )
        })}
      </RadioGroup>
      <p className="options-format-description">{t(selected.description)}</p>

      {showNoArchiveWarning && (
        <div className="flex items-start gap-2.5 p-4 text-amber-900 dark:text-amber-200">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">
              {t("options_noArchiveWarningTitle")}
            </p>
            <p className="text-[13px] leading-relaxed">
              {t("options_noArchiveWarningDesc")}
            </p>
          </div>
        </div>
      )}
    </SettingsGroup>
  )
}
