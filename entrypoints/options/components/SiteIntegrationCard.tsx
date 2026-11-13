/** Per-integration enablement, shared-setting overrides, and custom settings. */
import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { cn } from "@/src/shared/utils"
import { t } from "@/src/runtime/i18n"
import {
  SiteIntegrationCardHeader,
  IntegrationContributors,
} from "./SiteIntegrationCard-header"
import {
  SiteIntegrationOutputSettings,
  SiteIntegrationRateSettings,
  SiteIntegrationRetrySettings,
  SiteIntegrationCustomSettings,
} from "./SiteIntegrationCard-sections"
import {
  hasSiteOverrides,
  updateSiteOverride,
} from "./SiteIntegrationCard-model"
import type { SiteIntegrationCardProps } from "./SiteIntegrationCard-types"
import type { SiteOverrideRecord } from "@/src/domain/site-integrations/storage-schemas"

export function SiteIntegrationCard({
  siteIntegration,
  isEnabled,
  override,
  globalDefaults,
  siteIntegrationSettingsValues = {},
  onEnabledChange,
  onSiteIntegrationSettingsChange,
  onChange,
}: SiteIntegrationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasOverrides = hasSiteOverrides(override)
  const updateOverride = (updates: Partial<SiteOverrideRecord>) =>
    onChange(siteIntegration.id, updateSiteOverride(override, updates))
  const reset = () => {
    onChange(siteIntegration.id, null)
    setIsExpanded(false)
  }
  const sectionProps = {
    siteIntegration,
    override,
    globalDefaults,
    updateOverride,
  }
  return (
    <Card
      data-testid={`site-integration-card-${siteIntegration.id}`}
      className={cn(
        "options-integration-card overflow-hidden border-border/70 transition-colors duration-150",
        cardAppearance(isEnabled, hasOverrides)
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <SiteIntegrationCardHeader
          siteIntegration={siteIntegration}
          isEnabled={isEnabled}
          onEnabledChange={onEnabledChange}
          hasOverrides={hasOverrides}
          isExpanded={isExpanded}
        />
        <CollapsibleContent
          className="options-disclosure border-t border-border/60"
          inert={!isExpanded}
        >
          <CardContent className="flex flex-col gap-6 px-5 py-5">
            <SiteIntegrationOutputSettings {...sectionProps} />
            <SiteIntegrationRateSettings {...sectionProps} />
            <SiteIntegrationRetrySettings {...sectionProps} />
            {hasOverrides && (
              <Button
                data-testid={`reset-site-integration-overrides-${siteIntegration.id}`}
                variant="outline"
                size="sm"
                onClick={reset}
              >
                {t("options_clearOverrides")}
              </Button>
            )}
            <SiteIntegrationCustomSettings
              siteIntegration={siteIntegration}
              values={siteIntegrationSettingsValues}
              onChange={onSiteIntegrationSettingsChange}
            />
            <IntegrationContributors
              contributors={siteIntegration.contributors}
            />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function cardAppearance(enabled: boolean, overridden: boolean) {
  if (!enabled) return "bg-muted/15"
  return overridden ? "border-primary/30 bg-primary/5" : "hover:border-border"
}
