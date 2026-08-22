import React from "react"
import { cn } from "@/src/shared/utils"

interface SettingsSectionHeaderProps {
  id?: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function SettingsSectionHeader({
  id,
  title,
  description,
  action,
  className,
}: SettingsSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-border/40",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h1
          id={id}
          className="text-2xl font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
