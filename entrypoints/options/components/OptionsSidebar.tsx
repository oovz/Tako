import { useOptionsIndicator } from "../hooks/useOptionsMotion"
import { Activity, FolderArchive, Puzzle, Settings, Zap } from "lucide-react"

import { cn } from "@/src/shared/utils"
import type { OptionsSection } from "../tab-routing"
import { t } from "@/src/runtime/i18n"

interface OptionsSidebarProps {
  activeSection: OptionsSection
  onSectionChange: (section: OptionsSection) => void
}

const sections = [
  { id: "general", label: "options_general", icon: Settings },
  { id: "storage", label: "options_storage", icon: FolderArchive },
  { id: "network", label: "options_network", icon: Zap },
  { id: "integrations", label: "options_siteIntegrations", icon: Puzzle },
  { id: "activity", label: "options_activity", icon: Activity },
] as const

export function OptionsSidebar({
  activeSection,
  onSectionChange,
}: OptionsSidebarProps) {
  const navigation = useOptionsIndicator(activeSection, '[aria-current="page"]')
  return (
    <aside className="options-sidebar flex shrink-0 flex-col border-b bg-sidebar lg:w-60 lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="options-brand flex h-12 shrink-0 items-center gap-2.5 px-4 lg:h-14 lg:border-b">
        <img alt="" className="size-6 shrink-0" src="icon/32.png" />
        <span className="text-sm font-semibold tracking-tight lg:text-base">
          {t("options_takoSettings")}
        </span>
      </div>

      <nav
        ref={navigation}
        aria-label={t("options_takoSettings")}
        className="options-navigation grid grid-cols-3 gap-1 px-3 pb-3 sm:grid-cols-5 lg:flex lg:flex-col lg:pt-3"
      >
        <span className="options-indicator" aria-hidden="true" />
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            aria-current={id === activeSection ? "page" : undefined}
            className={cn(
              "flex min-h-9 min-w-0 w-full cursor-pointer items-center justify-center rounded-md px-1.5 py-1.5 text-center text-xs font-medium leading-snug transition-colors duration-150 lg:justify-start lg:gap-2.5 lg:px-3 lg:py-2 lg:text-left lg:text-sm",
              id === activeSection
                ? "bg-accent font-semibold text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon
              aria-hidden="true"
              className="hidden size-4 shrink-0 lg:block"
            />
            <span className="min-w-0 wrap-anywhere">{t(label)}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
