import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures/extension"

async function openPanel(page: Page, extensionId: string) {
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    Object.defineProperty(chrome.runtime, "sendMessage", {
      value: (message: { type: string }) =>
        message.type === "OPEN_OPTIONS"
          ? Promise.resolve({ success: false, error: "Options unavailable" })
          : send(message),
    })
  })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await expect(page.getByRole("button", { name: /Open Options/ })).toBeVisible()
}

function measureSlide(page: Page, exiting: boolean) {
  return page.evaluate(async (exiting) => {
    const control = document.querySelector<HTMLButtonElement>(
      exiting ? ".panel-feedback-dismiss" : ".panel-status button"
    )
    if (!control) throw new Error("Missing feedback control")
    control.click()
    // Sample the actual layout animation at fixed times. Advancing the clock
    // here also makes the test independent of the browser's frame rate.
    for (let frame = 0; frame < 15; frame++) {
      await new Promise(requestAnimationFrame)
      const slot = document.querySelector<HTMLElement>(".panel-feedback-slot")
      if (!slot || slot.inert !== exiting) continue
      const animation = slot
        .getAnimations()
        .find(
          (item): item is CSSTransition =>
            item instanceof CSSTransition &&
            item.transitionProperty === "grid-template-rows"
        )
      if (!animation) continue
      animation.pause()
      const duration = Number(animation.effect?.getComputedTiming().duration)
      const sizes = [0, duration / 2, duration].map((time) => {
        animation.currentTime = time
        return {
          slot: slot.getBoundingClientRect().height,
          bottom: Math.round(slot.getBoundingClientRect().bottom),
          tasks: document.querySelector(".panel-main")!.getBoundingClientRect()
            .height,
        }
      })
      const excluded = slot.inert && slot.getAttribute("aria-hidden") === "true"
      animation.finish()
      return { sizes, excluded, viewport: innerHeight }
    }
    throw new Error("The bottom feedback slot did not transition")
  }, exiting)
}

test("the bottom stack gives the task list space during entry and dismissal", async ({
  page,
  extensionId,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await openPanel(page, extensionId)
  const enter = await measureSlide(page, false)
  const [before, during, after] = enter.sizes
  expect(before.slot).toBe(0)
  expect(during.slot).toBeGreaterThan(0)
  expect(during.slot).toBeLessThan(after.slot)
  expect(before.tasks).toBeGreaterThan(during.tasks)
  expect(during.tasks).toBeGreaterThan(after.tasks)
  expect(enter.sizes.map((size) => size.bottom)).toEqual(
    Array(3).fill(enter.viewport)
  )
  await expect(page.getByText("Could not open Settings")).toBeVisible()

  const exit = await measureSlide(page, true)
  const [open, closing, closed] = exit.sizes
  expect(exit.excluded).toBe(true)
  expect(closing.slot).toBeLessThan(open.slot)
  expect(closing.slot).toBeGreaterThan(0)
  expect(closed.slot).toBe(0)
  expect(closed.tasks).toBeCloseTo(before.tasks)
  await expect(page.locator(".panel-feedback-slot")).toHaveCount(0)
})

test("the bottom stack opens and dismisses without movement in reduced motion", async ({
  page,
  extensionId,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await openPanel(page, extensionId)
  await page.getByRole("button", { name: /Open Options/ }).click()
  const slot = page.locator(".panel-feedback-slot")
  await expect(slot.getByRole("alert")).toHaveText("Could not open Settings")
  expect(await slot.evaluate((node) => node.getAnimations().length)).toBe(0)
  await slot.getByRole("button", { name: "Dismiss" }).focus()
  await page.keyboard.press("Enter")
  await expect(slot).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Queue" })).toBeFocused()
})
