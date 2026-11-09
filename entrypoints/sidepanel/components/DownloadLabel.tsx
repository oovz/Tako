import { useState } from "react"
import { t } from "@/src/runtime/i18n"

export function DownloadLabel({ count }: { count: number }) {
  const [numbers, setNumbers] = useState({ current: count, previous: count })
  if (numbers.current !== count)
    setNumbers({ current: count, previous: numbers.current })
  const animate =
    count > 0 && numbers.previous > 0 && count !== numbers.previous
  return (
    <span>
      {t("sidepanel_downloadAction")}
      {count > 0 && (
        <span aria-hidden="true">
          {" "}
          (
          <span
            className="count-wheel"
            data-animate={animate}
            data-direction={count > numbers.previous ? "up" : "down"}
          >
            {animate && (
              <span className="count-outgoing" key={"old-" + numbers.previous}>
                {numbers.previous}
              </span>
            )}
            <span className="count-value" key={count}>
              {count}
            </span>
          </span>
          )
        </span>
      )}
    </span>
  )
}
