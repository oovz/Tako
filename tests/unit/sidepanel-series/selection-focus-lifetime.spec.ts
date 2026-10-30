// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Collapsible } from "@/components/ui/collapsible"
import { useInlineSelectionPresence } from "@/entrypoints/sidepanel/SidePanelApp-selection"
import { SeriesContextCard } from "@/entrypoints/sidepanel/components/SeriesContextCard"
import { SeriesInlineSelection } from "@/entrypoints/sidepanel/components/SeriesInlineSelection"
import { useInlineSelectionState } from "@/entrypoints/sidepanel/hooks/useInlineSelectionState"
import { deriveSeriesContextFromActiveTabContext } from "@/entrypoints/sidepanel/hooks/sidepanelSeriesContextHelpers"
import type { SidepanelSeriesContextData } from "@/entrypoints/sidepanel/hooks/useSidepanelSeriesContext"
import { series } from "./fixtures"

describe("accepted selection enqueue focus lifetime", () => {
  let root: Root
  let container: HTMLDivElement
  let selection: ReturnType<typeof useInlineSelectionState>
  const onClosed = vi.fn()
  const onCloseError = vi.fn()
  const sendMessage = vi.fn()
  const session: Record<string, unknown> = {}

  function View({ data }: { data: SidepanelSeriesContextData }) {
    selection = useInlineSelectionState(data)
    const presence = useInlineSelectionPresence(
      selection.isInlineSelectionOpen,
      selection.setInlineSelectionOpen
    )
    return createElement(
      Collapsible,
      {
        open: selection.isInlineSelectionOpen,
        onOpenChange: presence.updateInlineSelectionOpen,
      },
      createElement(SeriesContextCard, {
        data,
        isExpanded: selection.isInlineSelectionOpen,
        triggerRef: presence.inlineSelectionTriggerRef,
      }),
      presence.isInlineSelectionVisible &&
        createElement(SeriesInlineSelection, {
          data,
          chapterSelectionsBySeries: selection.chapterSelectionsBySeries,
          setChapterSelectionsBySeries: selection.setChapterSelectionsBySeries,
          presentationBySeries: selection.presentationBySeries,
          setPresentationBySeries: selection.setPresentationBySeries,
          onAfterStart: () => {
            // Observe an async event callback failure without leaving an unhandled rejection.
            try {
              presence.closeInlineSelectionAndRestoreFocus()
              onClosed()
            } catch (error) {
              onCloseError(error)
            }
          },
        })
    )
  }

  async function render(data = series()) {
    await act(async () => root.render(createElement(View, { data })))
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("chrome", {
      ...chrome,
      runtime: {
        sendMessage,
        getURL: (path: string) => `chrome-extension://unit/${path}`,
      },
      storage: {
        session: {
          get: async () => ({ ...session }),
          set: async (value: Record<string, unknown>) =>
            Object.assign(session, value),
          remove: async (key: string) => {
            delete session[key]
          },
        },
      },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    for (const key of Object.keys(session)) delete session[key]
  })

  it.each([false, true])(
    "settles an accepted enqueue and closes selection when the context changes before response delivery: %s",
    async (contextChanges) => {
      const delivery = Promise.withResolvers<unknown>()
      const accepted: unknown[] = []
      const acceptedResponse = { success: true, taskId: "durably-accepted" }
      sendMessage.mockImplementation((message: { payload: unknown }) => {
        accepted.push(message.payload)
        return delivery.promise
      })
      await render()
      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-controls="inline-selection-panel"]'
      )!
      await act(async () => trigger.click())
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[role="checkbox"][aria-label="Chapter one"]'
          )!
          .click()
      )
      const download = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Download (1)")
      )!
      await act(async () => download.click())
      await vi.waitFor(() => expect(accepted).toHaveLength(1))
      expect(accepted[0]).toEqual({
        sourceWindowId: 3,
        sourceTabId: 7,
        sourceUrl: "https://mangadex.org/title/one",
        siteIntegrationId: "mangadex",
        seriesId: "one",
        seriesRevision: 2,
        selectedChapterIds: ["one"],
      })
      if (contextChanges) {
        await render(
          series({
            ...deriveSeriesContextFromActiveTabContext({ kind: "loading" }),
            tabId: 8,
            seriesRevision: 3,
          })
        )
        expect(trigger.isConnected).toBe(false)
        expect(
          container.querySelector('[aria-controls="inline-selection-panel"]')
        ).toBeNull()
      } else {
        const viewChoice =
          container.querySelector<HTMLButtonElement>('[role="radio"]')!
        viewChoice.focus()
        expect(document.activeElement).toBe(viewChoice)
      }
      await act(async () => delivery.resolve(acceptedResponse))
      await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce())
      expect(onCloseError).not.toHaveBeenCalled()
      expect(selection.isInlineSelectionOpen).toBe(false)
      expect(
        selection.chapterSelectionsBySeries["mangadex#one"]
      ).toBeUndefined()
      expect(sendMessage).toHaveBeenCalledOnce()
      if (!contextChanges) expect(document.activeElement).toBe(trigger)
    }
  )
})
