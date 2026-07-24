import { Languages } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getLocaleDisplayName, t } from "@/src/runtime/i18n"
import {
  SUPPORTED_LOCALES,
  type UiLanguagePreference,
} from "@/src/shared/ui-language"
import type { MotionPreference } from "@/src/shared/motion-preference"

interface GlobalInterfacePreferencesSectionProps {
  motionPreference: MotionPreference
  uiLanguage: UiLanguagePreference
  onMotionPreferenceChange: (preference: MotionPreference) => void
  onUiLanguageChange: (language: UiLanguagePreference) => void
}

export function GlobalInterfacePreferencesSection({
  motionPreference,
  uiLanguage,
  onMotionPreferenceChange,
  onUiLanguageChange,
}: GlobalInterfacePreferencesSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Languages className="size-5 text-muted-foreground" />
          <CardTitle role="heading" aria-level={2} className="text-base">
            {t("options_interfacePreferences")}
          </CardTitle>
        </div>
        <CardDescription>
          {t("options_interfacePreferencesDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ui-language">{t("options_uiLanguage")}</Label>
          <Select
            value={uiLanguage}
            onValueChange={(value) =>
              onUiLanguageChange(value as UiLanguagePreference)
            }
          >
            <SelectTrigger
              id="ui-language"
              aria-describedby="ui-language-description"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {t("options_languageAutomatic")}
              </SelectItem>
              {SUPPORTED_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {getLocaleDisplayName(locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p
            id="ui-language-description"
            className="text-sm text-muted-foreground"
          >
            {t("options_uiLanguageDesc")}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <Label htmlFor="motion-preference">
            {t("options_motionPreference")}
          </Label>
          <Select
            value={motionPreference}
            onValueChange={(value) =>
              onMotionPreferenceChange(value as MotionPreference)
            }
          >
            <SelectTrigger
              id="motion-preference"
              aria-describedby="motion-preference-description"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                {t("options_motionSystem")}
              </SelectItem>
              <SelectItem value="reduce">
                {t("options_motionReduce")}
              </SelectItem>
            </SelectContent>
          </Select>
          <p
            id="motion-preference-description"
            className="text-sm text-muted-foreground"
          >
            {t("options_motionPreferenceDesc")}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
