import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { parseDestinationIssues } from "@/src/runtime/destination-issue-state"

describe("DownloadsTab download-state query boundary", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "entrypoints",
      "options",
      "hooks",
      "useDownloadsTabState.ts"
    ),
    "utf8"
  )

  it("uses the typed Options query and storage signals without durable reads", () => {
    expect(source).toContain('type: "GET_OPTIONS_DOWNLOAD_STATE"')
    expect(source).toContain("chrome.storage.onChanged.addListener")
    expect(source).not.toContain("useChromeStorageValue")
    expect(source).not.toContain("chrome.storage.local.get")
    expect(source).not.toContain("getBytesInUse")
  })

  it("fails closed for malformed destination issues", () => {
    expect(() => parseDestinationIssues({ bogus: true })).toThrow()
    expect(
      parseDestinationIssues([
        {
          id: "task-1::fsa_permission_required",
          taskId: "task-1",
          kind: "fsa_permission_required",
          occurredAt: 123,
        },
      ])
    ).toEqual([
      {
        id: "task-1::fsa_permission_required",
        taskId: "task-1",
        kind: "fsa_permission_required",
        occurredAt: 123,
      },
    ])
  })
})
