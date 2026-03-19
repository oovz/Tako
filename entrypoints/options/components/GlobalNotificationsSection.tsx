import { Bell } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

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
          <CardTitle className="text-base">Notifications</CardTitle>
        </div>
        <CardDescription>Control browser notification behavior.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="notifications">Enable Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Show browser notifications for download completion and errors.
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
