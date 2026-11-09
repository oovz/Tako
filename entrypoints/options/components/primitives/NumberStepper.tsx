import { Minus, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { t } from "@/src/runtime/i18n"

export function NumberStepper({
  id,
  label,
  testId,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  testId: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="options-stepper">
      <button
        type="button"
        aria-label={t("options_decreaseValue", [label])}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden="true" />
      </button>
      <Input
        id={id}
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next))
            onChange(Math.min(max, Math.max(min, Math.trunc(next))))
        }}
      />
      <button
        type="button"
        aria-label={t("options_increaseValue", [label])}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  )
}
