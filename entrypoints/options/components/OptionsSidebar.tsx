import { Activity, FolderArchive, Puzzle, Settings, Zap } from "lucide-react"

import { cn } from "@/src/shared/utils"
import type { OptionsSection } from "../tab-routing"
import { t } from "@/src/runtime/i18n"

interface OptionsSidebarProps {
  activeSection: OptionsSection
  onSectionChange: (section: OptionsSection) => void
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-auto shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full cursor-pointer",
        active
          ? "bg-accent text-accent-foreground shadow-2xs font-semibold"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function OptionsSidebar({
  activeSection,
  onSectionChange,
}: OptionsSidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border/40 bg-sidebar md:w-64 md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border/40 px-4 md:h-14">
        <img
          aria-hidden="true"
          alt=""
          className="size-6 shrink-0"
          src="icon/32.png"
        />
        <span className="text-base font-semibold tracking-tight">
          {t("options_takoSettings")}
        </span>
      </div>

      <nav
        aria-label={t("options_takoSettings")}
        className="flex min-w-0 flex-row gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-x-visible md:p-3"
      >
        <NavItem
          icon={Settings}
          label={t("options_general")}
          active={activeSection === "general"}
          onClick={() => onSectionChange("general")}
        />
        <NavItem
          icon={FolderArchive}
          label={t("options_storage")}
          active={activeSection === "storage"}
          onClick={() => onSectionChange("storage")}
        />
        <NavItem
          icon={Zap}
          label={t("options_network")}
          active={activeSection === "network"}
          onClick={() => onSectionChange("network")}
        />
        <NavItem
          icon={Puzzle}
          label={t("options_siteIntegrations")}
          active={activeSection === "integrations"}
          onClick={() => onSectionChange("integrations")}
        />
        <NavItem
          icon={Activity}
          label={t("options_activity")}
          active={activeSection === "activity"}
          onClick={() => onSectionChange("activity")}
        />
      </nav>
      <div className="hidden border-t border-border/40 px-4 py-3 md:block">
        <span className="text-xs text-muted-foreground">
          {t("options_takoVersion", [chrome.runtime.getManifest().version])}
        </span>
      </div>
    </aside>
  )
}
