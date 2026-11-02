import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { t } from "@/src/runtime/i18n"
import type { SiteIntegrationCardProps } from "./SiteIntegrationCard-types"

function IntegrationContributors({
  contributors = [],
}: {
  contributors?: readonly string[]
}) {
  if (contributors.length === 0) return null
  const text =
    contributors.length === 1
      ? t("options_contributor", [contributors[0]])
      : t("options_contributors", [contributors.join(", ")])
  return <p className="text-xs text-muted-foreground">{text}</p>
}

export function SiteIntegrationCardHeader({
  siteIntegration,
  isEnabled,
  onEnabledChange,
  hasOverrides,
  isExpanded,
}: Pick<
  SiteIntegrationCardProps,
  "siteIntegration" | "isEnabled" | "onEnabledChange"
> & { hasOverrides: boolean; isExpanded: boolean }) {
  return (
    <CardHeader className="gap-0 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle
              role="heading"
              aria-level={2}
              className="text-base font-semibold"
            >
              {siteIntegration.name}
            </CardTitle>
            {!isEnabled && (
              <Badge
                variant="secondary"
                className="h-5 px-2 text-[10px] font-medium text-muted-foreground"
              >
                {t("options_disabled")}
              </Badge>
            )}
            {hasOverrides && (
              <Badge
                variant="outline"
                className="h-5 border-primary/40 bg-primary/10 px-2 text-[10px] font-medium text-foreground"
              >
                {t("options_override")}
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            {siteIntegration.domains.join(", ")}
          </CardDescription>
          <IntegrationContributors
            contributors={siteIntegration.contributors}
          />
          {siteIntegration.requiresBroadHttpsPermission && !isEnabled && (
            <p className="max-w-xl text-xs text-muted-foreground">
              {t("options_broadHostPermissionDescription", [
                siteIntegration.name,
              ])}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`${siteIntegration.id}-integration-enabled`}
              className="text-xs text-muted-foreground"
            >
              {t("options_enabled")}
            </Label>
            <Switch
              id={`${siteIntegration.id}-integration-enabled`}
              checked={isEnabled}
              aria-label={t("options_enableIntegration", [
                siteIntegration.name,
              ])}
              onCheckedChange={(checked) =>
                onEnabledChange?.(siteIntegration.id, checked)
              }
            />
          </div>
          <CollapsibleTrigger asChild>
            <Button
              data-testid={`configure-site-integration-${siteIntegration.id}`}
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs font-medium"
            >
              {isExpanded ? t("options_hide") : t("options_configure")}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
    </CardHeader>
  )
}
