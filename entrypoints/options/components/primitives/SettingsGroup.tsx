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
    <div
      className={cn(
        "grid gap-3",
        hasHeading &&
          "@min-[48rem]:grid-cols-[12rem_minmax(0,1fr)] @min-[48rem]:gap-6",
        containerClassName
      )}
    >
      {hasHeading && (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 @min-[48rem]:pt-3">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 className="text-base font-semibold text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-sm leading-snug text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 pb-0.5">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          "min-w-0 divide-y divide-border/70 rounded-lg bg-muted/50",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
