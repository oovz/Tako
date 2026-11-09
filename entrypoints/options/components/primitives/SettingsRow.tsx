import React from "react"
import { cn } from "@/src/shared/utils"

interface SettingsRowProps {
  title: React.ReactNode
  description?: React.ReactNode
  control?: React.ReactNode
  htmlFor?: string
  children?: React.ReactNode
  className?: string
  align?: "center" | "start"
}

export function SettingsRow({
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
      <div className={cn("settings-row-content", className)}>{children}</div>
    )
  }

  return (
    <div
      className={cn(
        "settings-row flex flex-wrap justify-between gap-3",
        align === "center" ? "items-center" : "items-start",
        className
      )}
    >
      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 wrap-anywhere">
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
          <div className="text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {control && (
        <div className="flex max-w-full min-w-0 shrink-0 items-center [&>*]:max-w-full">
          {control}
        </div>
      )}
    </div>
  )
}
