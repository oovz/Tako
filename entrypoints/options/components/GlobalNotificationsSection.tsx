import { Bell } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/src/runtime/i18n'

interface GlobalNotificationsSectionProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function GlobalNotificationsSection({ enabled, onChange }: GlobalNotificationsSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">{t('options_notifications')}</CardTitle>
        </div>
        <CardDescription>{t('options_notificationsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="notifications">{t('options_enableNotifications')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('options_enableNotificationsDesc')}
            </p>
          </div>
          <Switch
            id="notifications"
            data-testid="notifications-switch"
            checked={enabled}
            onCheckedChange={onChange}
          />
        </div>
      </CardContent>
    </Card>
  )
}
