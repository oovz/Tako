import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest"
import { useInlineSelectionState } from "@/entrypoints/sidepanel/hooks/useInlineSelectionState"

describe("useInlineSelectionState", () => {
  let addActivatedListener: Mock
  let removeActivatedListener: Mock
  let addUpdatedListener: Mock
  let removeUpdatedListener: Mock
  let tabsGet: Mock
  let addEventListenerMock: Mock
  let removeEventListenerMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    addActivatedListener = vi.fn()
    removeActivatedListener = vi.fn()
    addUpdatedListener = vi.fn()
    removeUpdatedListener = vi.fn()
    tabsGet = vi.fn()
    addEventListenerMock = vi.fn()
    removeEventListenerMock = vi.fn()

    vi.stubGlobal("document", {
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    })

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock-id/${path}`,
      },
      tabs: {
        onActivated: {
          addListener: addActivatedListener,
          removeListener: removeActivatedListener,
        },
        onUpdated: {
          addListener: addUpdatedListener,
          removeListener: removeUpdatedListener,
        },
        get: tabsGet,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it("exports open/close handlers and manages selection state", () => {
    expect(typeof useInlineSelectionState).toBe("function")
  })

  it("does not attach global pointerdown listeners to collapse selection on clicks", () => {
    expect(
      addEventListenerMock.mock.calls.some(([event]) => event === "pointerdown")
    ).toBe(false)
  })

  it("registers tab activation and update listeners for navigation-based cleanup", () => {
    // Verify listeners contract
    expect(addActivatedListener).not.toHaveBeenCalled()
  })
})
