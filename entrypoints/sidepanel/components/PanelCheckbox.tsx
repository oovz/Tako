import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react"

export const PanelCheckbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label?: string }
>(({ label, className = "", ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={"panel-check " + className}
    {...props}
  >
    {label && <span className="bulk-copy">{label}</span>}
    <span className="check-visual" aria-hidden="true">
      <svg className="check-glyph" viewBox="0 0 24 24" fill="none">
        <path
          d="m4 12 5 5L20 6"
          pathLength="1"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="minus-glyph" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12h14"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        />
      </svg>
    </span>
  </CheckboxPrimitive.Root>
))
PanelCheckbox.displayName = "PanelCheckbox"
