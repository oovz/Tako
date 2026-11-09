import React from "react"
import { cn } from "@/src/shared/utils"

interface SettingsGroupProps {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  containerClassName?: string
}

export function SettingsGroup({
  title,
  description,
  action,
  children,
  className,
  containerClassName,
}: SettingsGroupProps) {
  const hasHeading = Boolean(title || description || action)
  return (
    <div className={cn("settings-group", containerClassName)}>
      {hasHeading && (
        <div className="settings-group-heading">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 pb-0.5">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          "settings-group-panel min-w-0 divide-y divide-border/70",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
