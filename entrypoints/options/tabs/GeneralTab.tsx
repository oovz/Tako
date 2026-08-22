import React from "react"
import { Bell, Globe, Sparkles } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { ExtensionSettings } from "@/src/domain/settings/types"
import { getLocaleDisplayName, t } from "@/src/runtime/i18n"
import {
  SUPPORTED_LOCALES,
  type UiLanguagePreference,
} from "@/src/shared/ui-language"
import type { MotionPreference } from "@/src/shared/motion-preference"
import { SettingsGroup } from "../components/primitives/SettingsGroup"
import { SettingsRow } from "../components/primitives/SettingsRow"
import { SettingsSectionHeader } from "../components/primitives/SettingsSectionHeader"
import { ExtensionUpdateSection } from "../components/ExtensionUpdateSection"

interface GeneralTabProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
}

export function GeneralTab({ settings, onChange }: GeneralTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        id="options-general-heading"
        title={t("options_general")}
        description={t("options_interfacePreferencesDesc")}
      />

      {/* Interface Settings Group */}
      <SettingsGroup
        title={t("options_interfacePreferences")}
        description={t("options_interfacePreferencesDesc")}
      >
        <SettingsRow
          icon={Globe}
          title={t("options_uiLanguage")}
          description={t("options_uiLanguageDesc")}
          htmlFor="ui-language"
          control={
            <Select
              value={settings.uiLanguage}
              onValueChange={(value) =>
                onChange({ uiLanguage: value as UiLanguagePreference })
              }
            >
              <SelectTrigger id="ui-language" className="w-52">
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
          }
        />

        <SettingsRow
          icon={Sparkles}
          title={t("options_motionPreference")}
          description={t("options_motionPreferenceDesc")}
          htmlFor="motion-preference"
          control={
            <Select
              value={settings.motionPreference}
              onValueChange={(value) =>
                onChange({ motionPreference: value as MotionPreference })
              }
            >
              <SelectTrigger id="motion-preference" className="w-52">
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
          }
        />
      </SettingsGroup>

      {/* Notifications Settings Group */}
      <SettingsGroup
        title={t("options_notifications")}
        description={t("options_notificationsDesc")}
      >
        <SettingsRow
          icon={Bell}
          title={t("options_enableNotifications")}
          description={t("options_enableNotificationsDesc")}
          htmlFor="notifications"
          control={
            <Switch
              id="notifications"
              data-testid="notifications-switch"
              checked={settings.notifications}
              onCheckedChange={(enabled) =>
                onChange({ notifications: enabled })
              }
            />
          }
        />
      </SettingsGroup>

      {/* Extension Updates & Version */}
      <ExtensionUpdateSection />
    </div>
  )
}
