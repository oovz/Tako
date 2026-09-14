import { describe, expect, it } from "vitest"

import { resolveSourceTabId } from "@/entrypoints/background/sender-resolution"
import { classifyRuntimeMessagePrincipal } from "@/src/runtime/runtime-message-sender"

const EXTENSION_ID = "abcdefghijklmnop"

function tab(id: number): chrome.tabs.Tab {
  return { id } as chrome.tabs.Tab
}

describe("classifyRuntimeMessagePrincipal", () => {
  it.each([
    ["sidepanel", "/sidepanel.html", undefined, "sidepanel-document"],
    ["sidepanel", "/sidepanel.html", undefined, undefined],
    ["options", "/options.html?tab=downloads", undefined, "options-document"],
    ["options", "/options.html", undefined, undefined],
    ["offscreen", "/offscreen.html", undefined, "offscreen-document"],
    ["background", "/background.js", undefined, undefined],
    ["sidepanel", "/sidepanel.html", tab(5), "sidepanel-document"],
    ["sidepanel", "/sidepanel.html", tab(5), undefined],
  ] as const)(
    "classifies the exact %s extension principal",
    (principal, path, senderTab, documentId) => {
      expect(
        classifyRuntimeMessagePrincipal(
          {
            id: EXTENSION_ID,
            url: `chrome-extension://${EXTENSION_ID}${path}`,
            tab: senderTab,
            documentId,
          },
          EXTENSION_ID
        )
      ).toBe(principal)
    }
  )

  it("classifies the extension service worker identity", () => {
    expect(
      classifyRuntimeMessagePrincipal({ id: EXTENSION_ID }, EXTENSION_ID)
    ).toBe("background")
  })

  it("classifies an exact tabless offscreen sender when documentId is omitted", () => {
    expect(
      classifyRuntimeMessagePrincipal(
        {
          id: EXTENSION_ID,
          url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
        },
        EXTENSION_ID
      )
    ).toBe("offscreen")
  })

  it("classifies a same-extension web-page sender as content", () => {
    expect(
      classifyRuntimeMessagePrincipal(
        {
          id: EXTENSION_ID,
          url: "https://mangadex.org/title/abc",
          tab: tab(42),
        },
        EXTENSION_ID
      )
    ).toBe("content")
  })

  it.each([
    [{}, "unknown sender"],
    [
      {
        id: "another-extension",
        url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
      },
      "mismatched extension id",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/offscreen-settings.html`,
        documentId: "document",
      },
      "non-exact offscreen path",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/offscreen/index.html`,
      },
      "unbuilt offscreen index alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/offscreen`,
      },
      "unbuilt offscreen path alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/options/index.html`,
      },
      "unbuilt options index alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/options`,
      },
      "unbuilt options path alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/sidepanel/index.html`,
      },
      "unbuilt sidepanel index alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/sidepanel`,
      },
      "unbuilt sidepanel path alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/background`,
      },
      "unbuilt background path alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/_generated_background_page.html`,
      },
      "unbuilt background page alias",
    ],
    [
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
        tab: tab(7),
        documentId: "document",
      },
      "offscreen identity with a tab",
    ],
  ])("rejects %s (%s)", (sender, _label) => {
    expect(
      classifyRuntimeMessagePrincipal(
        sender as chrome.runtime.MessageSender,
        EXTENSION_ID
      )
    ).toBe("unknown")
  })
})

describe("resolveSourceTabId", () => {
  it("prefers the explicit sidepanel payload tab", () => {
    expect(resolveSourceTabId({ tab: tab(3) }, 9)).toBe(9)
  })

  it("uses sender.tab for content-script callers", () => {
    expect(resolveSourceTabId({ tab: tab(3) })).toBe(3)
  })

  it.each([-1, 1.5])("rejects invalid payload tab id %s", (payloadTabId) => {
    expect(resolveSourceTabId({ tab: tab(3) }, payloadTabId)).toBe(3)
  })
})
