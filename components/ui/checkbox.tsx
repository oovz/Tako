import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/src/shared/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    uncheckedIndicator?: React.ReactNode
  }
>(({ className, uncheckedIndicator, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer size-4 shrink-0 rounded-sm border border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
      className
    )}
    {...props}
  >
    {uncheckedIndicator}
    <CheckboxPrimitive.Indicator className="group/indicator grid place-content-center text-current">
      <Check
        aria-hidden="true"
        className="size-4 group-data-[state=indeterminate]/indicator:hidden"
      />
      <Minus
        aria-hidden="true"
        className="hidden size-3 group-data-[state=indeterminate]/indicator:block"
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
