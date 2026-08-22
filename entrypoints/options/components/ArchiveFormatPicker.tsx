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
        {/* CBZ Option */}
        <div>
          <RadioGroupItem
            value="cbz"
            id="format-cbz"
            className="peer sr-only"
          />
          <Label
            htmlFor="format-cbz"
            className={cn(
              "flex h-full cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:bg-muted/40",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
              value === "cbz"
                ? "border-primary bg-primary/5 shadow-2xs text-foreground"
                : "border-border bg-card text-foreground"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={cn(
                  "p-2 rounded-lg",
                  value === "cbz"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <FileType className="size-5" />
              </div>
              {value === "cbz" && (
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-semibold text-sm leading-none">
                {t("options_cbzArchive")}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {t("options_cbzArchiveDesc")}
              </div>
            </div>
          </Label>
        </div>

        {/* ZIP Option */}
        <div>
          <RadioGroupItem
            value="zip"
            id="format-zip"
            className="peer sr-only"
          />
          <Label
            htmlFor="format-zip"
            className={cn(
              "flex h-full cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:bg-muted/40",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
              value === "zip"
                ? "border-primary bg-primary/5 shadow-2xs text-foreground"
                : "border-border bg-card text-foreground"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={cn(
                  "p-2 rounded-lg",
                  value === "zip"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <FileArchive className="size-5" />
              </div>
              {value === "zip" && (
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-semibold text-sm leading-none">
                {t("options_zipArchive")}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {t("options_zipArchiveDesc")}
              </div>
            </div>
          </Label>
        </div>

        {/* None Option */}
        <div>
          <RadioGroupItem
            value="none"
            id="format-none"
            className="peer sr-only"
          />
          <Label
            htmlFor="format-none"
            className={cn(
              "flex h-full cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:bg-muted/40",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
              value === "none"
                ? "border-primary bg-primary/5 shadow-2xs text-foreground"
                : "border-border bg-card text-foreground"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={cn(
                  "p-2 rounded-lg",
                  value === "none"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Files className="size-5" />
              </div>
              {value === "none" && (
                <CheckCircle2
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-semibold text-sm leading-none">
                {t("options_noArchive")}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {t("options_noArchiveDesc")}
              </div>
            </div>
          </Label>
        </div>
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
