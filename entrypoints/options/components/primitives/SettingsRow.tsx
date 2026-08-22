import React from "react"
import { cn } from "@/src/shared/utils"

interface SettingsRowProps {
  icon?: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  description?: React.ReactNode
  control?: React.ReactNode
  htmlFor?: string
  children?: React.ReactNode
  className?: string
  align?: "center" | "start"
}

export function SettingsRow({
  icon: Icon,
  title,
  description,
  control,
  htmlFor,
  children,
  className,
  align = "center",
}: SettingsRowProps) {
  if (children) {
    return (
      <div className={cn("p-4 transition-colors hover:bg-muted/20", className)}>
        {children}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex justify-between gap-4 p-4 min-h-[3.5rem] transition-colors hover:bg-muted/20",
        align === "center" ? "items-center" : "items-start",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {Icon && (
          <div className="p-1.5 rounded-md bg-muted text-muted-foreground shrink-0 mt-0.5">
            <Icon className="size-4" />
          </div>
        )}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {htmlFor ? (
            <label
              htmlFor={htmlFor}
              className="text-sm font-medium text-foreground cursor-pointer select-none leading-snug"
            >
              {title}
            </label>
          ) : (
            <div className="text-sm font-medium text-foreground leading-snug">
              {title}
            </div>
          )}
          {description && (
            <div className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </div>
          )}
        </div>
      </div>
      {control && <div className="shrink-0 flex items-center">{control}</div>}
    </div>
  )
}
