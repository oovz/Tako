import { SettingsChoices } from "../components/primitives/SettingsChoices"
import React from "react"

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
      />

      {/* Interface Settings Group */}
      <SettingsGroup title={t("options_interfacePreferences")}>
        <SettingsRow
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
          title={t("options_motionPreference")}
          control={
            <SettingsChoices
              label={t("options_motionPreference")}
              value={settings.motionPreference}
              onChange={(motionPreference) => onChange({ motionPreference })}
              choices={[
                { value: "system", label: t("options_motionSystem") },
                { value: "reduce", label: t("options_motionReduce") },
              ]}
            />
          }
        />
      </SettingsGroup>

      {/* Notifications Settings Group */}
      <SettingsGroup title={t("options_notifications")}>
        <SettingsRow
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
