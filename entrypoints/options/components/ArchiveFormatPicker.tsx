import { AlertTriangle } from "lucide-react"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { t } from "@/src/runtime/i18n"
import { cn } from "@/src/shared/utils"
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
  return (
    <SettingsGroup title={label}>
      <RadioGroup
        aria-label={label}
        data-testid="archive-format-radiogroup"
        value={value}
        onValueChange={(nextValue) =>
          onValueChange(nextValue as ArchiveFormatPickerProps["value"])
        }
        className="gap-0 divide-y divide-border/70"
      >
        {archiveOptions.map((option) => (
          <div
            key={option.format}
            className={cn(
              "flex items-center gap-3 px-4 transition-colors",
              value === option.format ? "bg-accent" : "hover:bg-muted"
            )}
          >
            <RadioGroupItem
              value={option.format}
              id={`format-${option.format}`}
            />
            <Label
              htmlFor={`format-${option.format}`}
              className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 py-2 leading-snug"
            >
              <span>{t(option.label)}</span>
              <span className="text-[13px] font-normal text-muted-foreground">
                {t(option.description)}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>

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
