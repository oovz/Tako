interface SettingsSectionHeaderProps {
  id: string
  title: string
  description?: string
}

export function SettingsSectionHeader({
  id,
  title,
  description,
}: SettingsSectionHeaderProps) {
  return (
    <header>
      <h1 id={id} className="text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  )
}
