import * as React from "react"

import { cn } from "@/src/shared/utils"

export const DialogHeaderLayout = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col text-center sm:text-left", className)}
    {...props}
  />
)

export const DialogFooterLayout = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
