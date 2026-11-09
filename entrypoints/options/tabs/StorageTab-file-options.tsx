import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { t } from "@/src/runtime/i18n"
import { SettingsRow } from "../components/primitives/SettingsRow"

export function StorageFileOptions({
  downloads,
  onChange,
}: {
  downloads: ExtensionSettings["downloads"]
  onChange: (updates: Partial<ExtensionSettings["downloads"]>) => void
}) {
  return (
    <fieldset className="options-file-controls">
      <legend>
        {t(
          downloads.defaultFormat === "none"
            ? "options_chapterFolderContents"
            : "options_archiveContents"
        )}
      </legend>
      <SettingsRow
        title={t("options_normalizeFilenames")}
        description={t("options_normalizeFilenamesDesc")}
        htmlFor="normalize"
        control={
          <Switch
            id="normalize"
            data-testid="normalize-switch"
            checked={downloads.normalizeImageFilenames}
            onCheckedChange={(checked) =>
              onChange({ normalizeImageFilenames: checked })
            }
          />
        }
      />

      {downloads.normalizeImageFilenames && (
        <SettingsRow
          title={t("options_imagePadding")}
          description={t("options_imagePaddingDesc")}
          htmlFor="image-padding"
          control={
            <Select
              value={String(downloads.imagePaddingDigits ?? "auto")}
              onValueChange={(value) =>
                onChange({
                  imagePaddingDigits:
                    value === "auto"
                      ? "auto"
                      : (parseInt(value) as 2 | 3 | 4 | 5),
                })
              }
            >
              <SelectTrigger
                id="image-padding"
                data-testid="image-padding-select"
                className="w-60"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("options_paddingAuto")}</SelectItem>
                <SelectItem value="2">{t("options_padding2")}</SelectItem>
                <SelectItem value="3">{t("options_padding3")}</SelectItem>
                <SelectItem value="4">{t("options_padding4")}</SelectItem>
                <SelectItem value="5">{t("options_padding5")}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      )}
      <SettingsRow
        title={t("options_includeComicInfo")}
        description={t("options_includeComicInfoDesc")}
        htmlFor="comicinfo"
        control={
          <Switch
            id="comicinfo"
            data-testid="comicinfo-switch"
            checked={downloads.includeComicInfo}
            onCheckedChange={(checked) =>
              onChange({ includeComicInfo: checked })
            }
          />
        }
      />

      <SettingsRow
        title={t("options_includeCover")}
        description={t("options_includeCoverDesc")}
        htmlFor="cover-image"
        control={
          <Switch
            id="cover-image"
            data-testid="cover-image-switch"
            checked={downloads.includeCoverImage}
            onCheckedChange={(checked) =>
              onChange({ includeCoverImage: checked })
            }
          />
        }
      />
    </fieldset>
  )
}
