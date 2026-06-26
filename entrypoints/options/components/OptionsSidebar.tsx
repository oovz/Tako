import { Bug, Download, Puzzle, Settings } from 'lucide-react'

import { cn } from '@/src/shared/utils'
import type { OptionsSection } from '../tab-routing'
import { t } from '@/src/shared/i18n'

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
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
        active
          ? 'bg-accent text-accent-foreground font-medium border-l-2 border-l-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
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
        <span className="text-base font-semibold">{t('options_takoSettings')}</span>
      </div>

      <nav className="flex-1 flex flex-col gap-1 p-3">
        <NavItem
          icon={Settings}
          label={t('options_general')}
          active={activeSection === 'global'}
          onClick={() => onSectionChange('global')}
        />
        <NavItem
          icon={Puzzle}
          label={t('options_siteIntegrations')}
          active={activeSection === 'integrations'}
          onClick={() => onSectionChange('integrations')}
        />
        <NavItem
          icon={Download}
          label={t('options_downloads')}
          active={activeSection === 'downloads'}
          onClick={() => onSectionChange('downloads')}
        />
        <NavItem
          icon={Bug}
          label={t('options_aboutDebug')}
          active={activeSection === 'debug'}
          onClick={() => onSectionChange('debug')}
        />
      </nav>
      <div className="border-t border-border/40 px-4 py-3">
        <span className="text-xs text-muted-foreground">{t('options_takoVersion', [chrome.runtime.getManifest().version])}</span>
      </div>
    </aside>
  )
}

