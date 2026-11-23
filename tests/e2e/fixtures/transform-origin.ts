import { expect, type Locator, type Page } from "@playwright/test"

export interface TransformOriginInfo {
  transformOrigin: string
  radixOrigin: string
  width: number
  height: number
}

/** Runs inside the page via locator.evaluate; keep it self-contained. */
export function readTransformOriginInfo(
  element: Element,
  variable: string
): TransformOriginInfo {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  let radixOrigin = ""
  for (
    let node: Element | null = element;
    node && !radixOrigin;
    node = node.parentElement
  ) {
    radixOrigin = getComputedStyle(node).getPropertyValue(variable).trim()
  }
  return {
    transformOrigin: style.transformOrigin,
    radixOrigin,
    width: rect.width,
    height: rect.height,
  }
}

function parseOriginAxis(value: string, size: number): number {
  const trimmed = value.trim()
  if (trimmed.endsWith("%")) {
    return (Number.parseFloat(trimmed) / 100) * size
  }
  return Number.parseFloat(trimmed)
}

/**
 * Popper content must scale from the trigger, so its computed transform-origin
 * has to resolve to the Radix-provided origin variable rather than the
 * element center (which is what a malformed transform-origin declaration
 * silently falls back to).
 */
export function expectTransformOriginFromTrigger(info: TransformOriginInfo) {
  const [originX, originY] = info.transformOrigin
    .trim()
    .split(/\s+/)
    .map((part, index) =>
      parseOriginAxis(part, index === 0 ? info.width : info.height)
    )
  const centerDistance = Math.hypot(
    originX - info.width / 2,
    originY - info.height / 2
  )
  expect(
    centerDistance,
    `transform-origin "${info.transformOrigin}" resolved to the element center`
  ).toBeGreaterThan(1)
  if (!info.radixOrigin) return
  const [radixX, radixY] = info.radixOrigin
    .trim()
    .split(/\s+/)
    .map((part, index) =>
      parseOriginAxis(part, index === 0 ? info.width : info.height)
    )
  expect(
    Math.abs(originX - radixX),
    `transform-origin "${info.transformOrigin}" should match "${info.radixOrigin}"`
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(originY - radixY),
    `transform-origin "${info.transformOrigin}" should match "${info.radixOrigin}"`
  ).toBeLessThanOrEqual(1)
}

/** Resolve the portaled tooltip content linked through aria-describedby. */
export async function tooltipContentFor(
  page: Page,
  trigger: Locator
): Promise<Locator> {
  await expect
    .poll(async () => trigger.getAttribute("aria-describedby"))
    .not.toBeNull()
  const id = await trigger.getAttribute("aria-describedby")
  if (!id) throw new Error("Tooltip trigger has no described content")
  return page.locator(`[id="${id}"]`)
}
