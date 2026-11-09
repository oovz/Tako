import { useOptionsIndicator } from "../../hooks/useOptionsMotion"
import * as RadioGroup from "@radix-ui/react-radio-group"

export function SettingsChoices<Value extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string
  value: Value
  choices: readonly { value: Value; label: string }[]
  onChange: (value: Value) => void
}) {
  const group = useOptionsIndicator<HTMLDivElement>(
    value,
    '[role="radio"][data-state="checked"]'
  )
  return (
    <RadioGroup.Root
      ref={group}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const choice = choices.find((item) => item.value === next)
        if (choice) onChange(choice.value)
      }}
      className="options-choices flex flex-wrap gap-1 rounded-md border bg-muted p-1"
    >
      <span className="options-indicator" aria-hidden="true" />
      {choices.map((choice) => (
        <RadioGroup.Item
          key={choice.value}
          value={choice.value}
          className="settings-choice min-h-8 max-w-full flex-auto cursor-pointer rounded-sm border border-transparent px-2.5 py-1 text-sm leading-snug wrap-break-word text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 data-[state=checked]:border-input data-[state=checked]:bg-background data-[state=checked]:text-foreground"
        >
          {choice.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
