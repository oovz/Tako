// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useCoverPreview } from "@/entrypoints/sidepanel/hooks/useCoverPreview"
import type { CoverPreviewIdentity } from "@/entrypoints/sidepanel/services/cover-preview-loader"

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("@/src/runtime/send-runtime-message", () => ({
  sendRuntimeMessage: send,
}))

const identity: CoverPreviewIdentity = {
  integrationId: "mycomic",
  coverUrl: "https://images.example/cover.jpg",
  source: { kind: "task", taskId: "task-one" },
}
const response = (request = identity) => ({
  success: true,
  integrationId: request.integrationId,
  coverUrl: request.coverUrl,
  mimeType: "image/jpeg",
  base64: btoa("cover"),
})
let root: Root
let container: HTMLDivElement
const revoke = vi.fn()
const create = vi.fn()
function View({ request }: { request?: CoverPreviewIdentity }) {
  const preview = useCoverPreview(request)
  return createElement(
    "output",
    null,
    preview.status === "ready" ? preview.url : preview.status
  )
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "Image",
    class {
      src = ""
      naturalWidth = 10
      naturalHeight = 10
      async decode() {}
      removeAttribute() {}
    }
  )
  create.mockReset().mockReturnValue("blob:cover")
  revoke.mockReset()
  vi.spyOn(URL, "createObjectURL").mockImplementation(create)
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke)
  send
    .mockReset()
    .mockImplementation(async (message) =>
      message.type === "GET_COVER_PREVIEW" ? response() : { success: true }
    )
  container = document.createElement("div")
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  window.dispatchEvent(new Event("pagehide"))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("retains equivalent requests across rerenders and releases the Blob cache on page hide", async () => {
  await act(async () => root.render(createElement(View)))
  expect(container.textContent).toBe("fallback")
  expect(send).not.toHaveBeenCalled()
  await act(async () => root.render(createElement(View, { request: identity })))
  expect(container.textContent).toBe("blob:cover")
  await act(async () =>
    root.render(
      createElement(View, {
        request: { ...identity, source: { ...identity.source } },
      })
    )
  )
  expect(send).toHaveBeenCalledTimes(1)
  act(() => root.unmount())
  expect(revoke).not.toHaveBeenCalled()
  window.dispatchEvent(new Event("pagehide"))
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:cover")
})

it("releases a replaced request and ignores its delayed response", async () => {
  const old = Promise.withResolvers<ReturnType<typeof response>>()
  send.mockImplementation(async (message) => {
    if (message.type !== "GET_COVER_PREVIEW") return { success: true }
    return message.payload.source.taskId === "task-one"
      ? old.promise
      : response({ ...identity, coverUrl: `${identity.coverUrl}?new` })
  })
  await act(async () => root.render(createElement(View, { request: identity })))
  expect(container.textContent).toBe("loading")
  const replacement = {
    ...identity,
    coverUrl: `${identity.coverUrl}?new`,
    source: { kind: "task" as const, taskId: "task-two" },
  }
  await act(async () =>
    root.render(createElement(View, { request: replacement }))
  )
  expect(container.textContent).toBe("blob:cover")
  expect(
    send.mock.calls.some(([message]) => message.type === "CANCEL_COVER_PREVIEW")
  ).toBe(true)
  await act(async () => old.resolve(response()))
  expect(create).toHaveBeenCalledTimes(1)
  expect(container.textContent).toBe("blob:cover")
})

it("uses the complete series authorization and falls back when the request is removed", async () => {
  const request: CoverPreviewIdentity = {
    ...identity,
    source: {
      kind: "series",
      tabId: 7,
      windowId: 2,
      seriesId: "series",
      seriesRevision: 3,
    },
  }
  await act(async () => root.render(createElement(View, { request })))
  expect(send.mock.calls[0][0].payload.source).toEqual(request.source)
  expect(container.textContent).toBe("blob:cover")
  await act(async () => root.render(createElement(View)))
  expect(container.textContent).toBe("fallback")
})

it("keeps the replacement cover ready when another consumer's old shared cover finishes later", async () => {
  const old = Promise.withResolvers<ReturnType<typeof response>>()
  const replacement: CoverPreviewIdentity = {
    ...identity,
    coverUrl: `${identity.coverUrl}?new`,
    source: { kind: "task", taskId: "task-two" },
  }
  const retained: CoverPreviewIdentity = {
    ...identity,
    source: { kind: "task", taskId: "retained" },
  }
  send.mockImplementation(async (message) => {
    if (message.type !== "GET_COVER_PREVIEW") return { success: true }
    return message.payload.source.taskId === "task-two"
      ? response(replacement)
      : old.promise
  })
  create.mockReturnValueOnce("blob:new").mockReturnValueOnce("blob:old")
  const views = (request: CoverPreviewIdentity) =>
    createElement(
      "section",
      null,
      createElement(View, { key: "changing", request }),
      createElement(View, { key: "retained", request: retained })
    )
  const displayed = () =>
    Array.from(container.querySelectorAll("output"), (node) => node.textContent)
  await act(async () => root.render(views(identity)))
  expect(displayed()).toEqual(["loading", "loading"])
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => root.render(views(replacement)))
  expect(displayed()).toEqual(["blob:new", "loading"])
  await act(async () => old.resolve(response()))
  expect(displayed()).toEqual(["blob:new", "blob:old"])
  expect(create).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenCalledTimes(2)
  expect(revoke).not.toHaveBeenCalled()
})
