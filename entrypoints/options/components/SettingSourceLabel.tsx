import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { t } from "@/src/runtime/i18n"

const sourceBadges = {
  override: { variant: "default", label: "options_override" },
  siteIntegration: {
    variant: "secondary",
    label: "options_siteIntegrationDefault",
  },
  global: { variant: "outline", label: "options_globalDefault" },
} as const

export function SettingSourceLabel({
  id,
  label,
  source,
}: {
  id: string
  label: string
  source?: keyof typeof sourceBadges
}) {
  const badge = source && sourceBadges[source]
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Label htmlFor={id}>{label}</Label>
      {badge && (
        <Badge id={`${id}-source`} variant={badge.variant}>
          {t(badge.label)}
        </Badge>
      )}
    </div>
  )
}
