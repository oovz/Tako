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
  return (
    <div className={cn("flex flex-col gap-2", containerClassName)}>
      {(title || description || action) && (
        <div className="flex items-end justify-between px-1 gap-2">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 className="text-sm font-semibold text-foreground tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 pb-0.5">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          "rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden shadow-2xs",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
