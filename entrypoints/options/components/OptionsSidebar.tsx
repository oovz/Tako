import { Bug, Download, Puzzle, Settings } from 'lucide-react'

import { cn } from '@/src/shared/utils'
import type { OptionsSection } from '../tab-routing'

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
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}

export function OptionsSidebar({ activeSection, onSectionChange }: OptionsSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border/40 bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border/40 px-4">
        <img aria-hidden="true" alt="" className="size-6 shrink-0" src="icon/32.png" />
        <span className="text-base font-semibold">Tako Settings</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        <NavItem
          icon={Settings}
          label="General"
          active={activeSection === 'global'}
          onClick={() => onSectionChange('global')}
        />
        <NavItem
          icon={Puzzle}
          label="Site Integrations"
          active={activeSection === 'integrations'}
          onClick={() => onSectionChange('integrations')}
        />
        <NavItem
          icon={Download}
          label="Downloads"
          active={activeSection === 'downloads'}
          onClick={() => onSectionChange('downloads')}
        />
        <NavItem
          icon={Bug}
          label="About / Debug"
          active={activeSection === 'debug'}
          onClick={() => onSectionChange('debug')}
        />
      </nav>
    </aside>
  )
}

