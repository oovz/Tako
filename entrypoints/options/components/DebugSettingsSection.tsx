/**
 * DebugSettingsSection - Debug and advanced settings for About/Debug tab
 * Uses same styling patterns as other tabs for consistency.
 */

import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bug } from "lucide-react"
import type { ExtensionSettings } from "@/src/storage/settings-types"
import { t } from '@/src/runtime/i18n'

interface DebugSettingsSectionProps {
  settings: ExtensionSettings
  onChange: (updates: Partial<ExtensionSettings>) => void
}

export function DebugSettingsSection({
  settings,
  onChange,
}: DebugSettingsSectionProps) {

  const updateAdvanced = (updates: Partial<ExtensionSettings['advanced']>) => {
    onChange({ advanced: { ...settings.advanced, ...updates } })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('options_aboutDebug')}</h1>
        <p className="text-sm text-muted-foreground">{t('options_aboutDebugDesc')}</p>
      </div>

      <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Bug className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">{t('options_debugSettings')}</CardTitle>
        </div>
        <CardDescription>{t('options_debugSettingsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Log Level Selector (replaces debugMode toggle) */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="log-level">{t('options_logLevel')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('options_logLevelDesc')}
              </p>
            </div>
            <Select
              value={settings.advanced.logLevel}
              onValueChange={(val) => updateAdvanced({ logLevel: val as 'error' | 'warn' | 'info' | 'debug' })}
            >
              <SelectTrigger id="log-level" data-testid="log-level-select" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">{t('options_logLevelError')}</SelectItem>
                <SelectItem value="warn">{t('options_logLevelWarn')}</SelectItem>
                <SelectItem value="info">{t('options_logLevelInfo')}</SelectItem>
                <SelectItem value="debug">{t('options_logLevelDebug')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
    </div>
  )
}
