type NotificationsShape = {
  notifications?: boolean
}

export function areNotificationsEnabled(settings: NotificationsShape | undefined): boolean {
  if (typeof settings?.notifications === 'boolean') {
    return settings.notifications
  }

  return true
}
