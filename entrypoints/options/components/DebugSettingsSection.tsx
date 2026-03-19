/**
 * DebugSettingsSection - Debug and advanced settings for About/Debug tab
 * Uses same styling patterns as other tabs for consistency.
 */

import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bug } from "lucide-react"
import type { ExtensionSettings } from "@/src/storage/settings-types"

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
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Bug className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">Debug Settings</CardTitle>
        </div>
        <CardDescription>Debugging options.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Log Level Selector (replaces debugMode toggle) */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="log-level">Log Level</Label>
              <p className="text-sm text-muted-foreground">
                Console verbosity. Use "debug" for troubleshooting.
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
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
