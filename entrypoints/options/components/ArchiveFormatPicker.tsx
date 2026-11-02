import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  Files,
  FileType,
} from "lucide-react"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { t } from "@/src/runtime/i18n"
import { cn } from "@/src/shared/utils"

interface ArchiveFormatPickerProps {
  showNoArchiveWarning: boolean
  value: "cbz" | "zip" | "none"
  onValueChange: (value: "cbz" | "zip" | "none") => void
}

export function ArchiveFormatPicker({
  showNoArchiveWarning,
  value,
  onValueChange,
}: ArchiveFormatPickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <Label
        id="archive-format-label"
        className="text-sm font-semibold text-foreground tracking-tight"
      >
        {t("options_archiveFormat")}
      </Label>
      <RadioGroup
        aria-labelledby="archive-format-label"
        data-testid="archive-format-radiogroup"
        value={value}
        onValueChange={(nextValue) =>
          onValueChange(nextValue as "cbz" | "zip" | "none")
        }
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        {ARCHIVE_OPTIONS.map((option) => (
          <ArchiveFormatOption
            key={option.format}
            {...option}
            selected={value === option.format}
          />
        ))}
      </RadioGroup>

      {showNoArchiveWarning && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold">
              {t("options_noArchiveWarningTitle")}
            </p>
            <p className="text-xs opacity-90 leading-relaxed">
              {t("options_noArchiveWarningDesc")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const ARCHIVE_OPTIONS = [
  {
    format: "cbz",
    Icon: FileType,
    label: "options_cbzArchive",
    description: "options_cbzArchiveDesc",
  },
  {
    format: "zip",
    Icon: FileArchive,
    label: "options_zipArchive",
    description: "options_zipArchiveDesc",
  },
  {
    format: "none",
    Icon: Files,
    label: "options_noArchive",
    description: "options_noArchiveDesc",
  },
] as const

function ArchiveFormatOption({
  format,
  Icon,
  label,
  description,
  selected,
}: (typeof ARCHIVE_OPTIONS)[number] & { selected: boolean }) {
  return (
    <div>
      <RadioGroupItem
        value={format}
        id={`format-${format}`}
        className="peer sr-only"
      />
      <Label
        htmlFor={`format-${format}`}
        className={cn(
          "flex h-full cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:bg-muted/40",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
          selected
            ? "border-primary bg-primary/5 shadow-2xs text-foreground"
            : "border-border bg-card text-foreground"
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className={cn(
              "p-2 rounded-lg",
              selected
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-5" />
          </div>
          {selected && (
            <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-sm leading-none">{t(label)}</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {t(description)}
          </div>
        </div>
      </Label>
    </div>
  )
}
