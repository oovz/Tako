import { describe, expect, it, vi } from "vitest"

import {
  createRuntimeMessageListener,
  dispatchRuntimeMessage,
} from "@/src/runtime/runtime-message-dispatcher"

const command = {
  target: "background",
  type: "ACKNOWLEDGE_ERROR",
  commandId: "00000000-0000-4000-8000-000000000001",
  issuedAt: 1,
  payload: { code: "test-error" },
} as const

describe("runtime message dispatcher", () => {
  it("claims its literal target synchronously and ignores absent or other targets", () => {
    const classifySender = vi.fn(() => "sidepanel" as const)
    const listener = createRuntimeMessageListener({
      target: "background",
      handlers: {} as never,
      classifySender,
      waitForReadiness: vi.fn(),
    })
    const sendResponse = vi.fn()

    expect(listener({}, {}, sendResponse)).toBe(false)
    expect(
      listener(
        { target: "offscreen", type: "OFFSCREEN_STATUS" },
        {},
        sendResponse
      )
    ).toBe(false)
    expect(classifySender).not.toHaveBeenCalled()
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it("does not enter authorization or readiness for parse failures", async () => {
    const classifySender = vi.fn(() => "sidepanel" as const)
    const waitForReadiness = vi.fn()

    await expect(
      dispatchRuntimeMessage(
        { ...command, protocolVersion: 1 },
        {},
        {
          target: "background",
          handlers: {} as never,
          classifySender,
          waitForReadiness,
        }
      )
    ).resolves.toEqual({
      success: false,
      error: "Invalid ACKNOWLEDGE_ERROR request",
    })
    expect(classifySender).not.toHaveBeenCalled()
    expect(waitForReadiness).not.toHaveBeenCalled()
  })

  it("does not enter readiness for unauthorized senders", async () => {
    const waitForReadiness = vi.fn()

    await expect(
      dispatchRuntimeMessage(
        command,
        {},
        {
          target: "background",
          handlers: {} as never,
          classifySender: () => "content",
          waitForReadiness,
        }
      )
    ).resolves.toEqual({
      success: false,
      error: "ACKNOWLEDGE_ERROR is not authorized for content",
    })
    expect(waitForReadiness).not.toHaveBeenCalled()
  })

  it("orders authorization, readiness, handler, and response validation", async () => {
    const order: string[] = []
    const handler = vi.fn(() => {
      order.push("handler")
      return { success: true }
    })

    const response = await dispatchRuntimeMessage(
      command,
      {},
      {
        target: "background",
        handlers: { ACKNOWLEDGE_ERROR: handler } as never,
        classifySender: () => {
          order.push("authorize")
          return "sidepanel"
        },
        waitForReadiness: async () => {
          order.push("readiness")
        },
      }
    )

    expect(response).toEqual({ success: true })
    expect(order).toEqual(["authorize", "readiness", "handler"])
  })

  it("maps handler failures and invalid responses to the failure schema", async () => {
    const response = await dispatchRuntimeMessage(
      command,
      {},
      {
        target: "background",
        handlers: {
          ACKNOWLEDGE_ERROR: () => ({ success: true, legacy: true }),
        } as never,
        classifySender: () => "sidepanel",
        waitForReadiness: async () => undefined,
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Handler returned an invalid ACKNOWLEDGE_ERROR response",
    })
  })

  it("orders parse, authorization, readiness, handler, and response validation", async () => {
    const order: string[] = []
    const response = await dispatchRuntimeMessage(
      {
        target: "background",
        type: "OPEN_OPTIONS",
        payload: {},
      },
      {},
      {
        target: "background",
        handlers: {
          OPEN_OPTIONS: () => {
            order.push("handler")
            return { success: true }
          },
        } as never,
        classifySender: () => {
          order.push("authorize")
          return "sidepanel"
        },
        waitForReadiness: async () => {
          order.push("readiness")
        },
      }
    )

    expect(response).toEqual({ success: true })
    expect(order).toEqual(["authorize", "readiness", "handler"])
  })

  it.each([
    {
      success: true,
      seriesMetadata: { title: "Series", unsupported: true },
    },
    {
      success: true,
      chapterList: {
        chapters: [
          {
            id: "chapter-1",
            url: "https://example.test/chapter-1",
            title: "Chapter 1",
            comicInfo: { Title: "Chapter 1", unsupported: true },
          },
        ],
      },
    },
  ])("rejects malformed nested handler output %#", async (handlerResponse) => {
    const response = await dispatchRuntimeMessage(
      {
        target: "offscreen",
        type: "OFFSCREEN_PARSE_SERIES_HTML",
        payload: {
          requestId: "00000000-0000-4000-8000-000000000001",
          siteIntegrationId: "site",
          seriesUrl: "https://example.test/series",
          html: "<html />",
          rateLimitSettings: {
            image: { concurrency: 1, delayMs: 0 },
            chapter: { concurrency: 1, delayMs: 0 },
          },
        },
      },
      {},
      {
        target: "offscreen",
        handlers: {
          OFFSCREEN_PARSE_SERIES_HTML: () => handlerResponse,
        } as never,
        classifySender: () => "background",
        waitForReadiness: async () => undefined,
      }
    )

    expect(response).toEqual({
      success: false,
      error: "Handler returned an invalid OFFSCREEN_PARSE_SERIES_HTML response",
    })
  })

  it.each([
    [
      "OFFSCREEN_JOB_ACCEPTED",
      {
        target: "background",
        type: "OFFSCREEN_JOB_ACCEPTED",
        payload: {
          jobId: "job-1",
          attempt: 1,
          taskId: "task-1",
          chapterId: "chapter-1",
          fingerprint: "a".repeat(64),
          documentInstanceId: "document-1",
          acceptedAt: 1,
          sequence: 1,
        },
      },
    ],
    [
      "OFFSCREEN_JOB_HEARTBEAT",
      {
        target: "background",
        type: "OFFSCREEN_JOB_HEARTBEAT",
        payload: {
          jobId: "job-1",
          attempt: 1,
          taskId: "task-1",
          chapterId: "chapter-1",
          fingerprint: "a".repeat(64),
          documentInstanceId: "document-1",
          stage: "downloading",
          sentAt: 1,
          sequence: 2,
        },
      },
    ],
  ] as const)("holds %s behind queue hydration", async (type, message) => {
    let releaseHydration!: () => void
    const waitForReadiness = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseHydration = resolve
        })
    )
    const handler = vi.fn(
      () => ({ success: true, disposition: "renewed" }) as const
    )
    const response = dispatchRuntimeMessage(
      message,
      {},
      {
        target: "background",
        handlers: { [type]: handler } as never,
        classifySender: () => "offscreen",
        waitForReadiness,
      }
    )

    await vi.waitFor(() =>
      expect(waitForReadiness).toHaveBeenCalledWith("queue-hydrated")
    )
    expect(handler).not.toHaveBeenCalled()

    releaseHydration()

    await expect(response).resolves.toEqual({
      success: true,
      disposition: "renewed",
    })
    expect(handler).toHaveBeenCalledOnce()
  })
})
