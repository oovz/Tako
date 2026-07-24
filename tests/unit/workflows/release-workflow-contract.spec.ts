import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const workspaceRoot = process.cwd()

function readWorkflow(name: string): string {
  return fs.readFileSync(
    path.join(workspaceRoot, ".github", "workflows", name),
    "utf8"
  )
}

describe("release workflow contract", () => {
  it("pins every external action and prevents checkout credential persistence", () => {
    const workflowNames = [
      "ci.yml",
      "live-e2e.yml",
      "publish-wiki.yml",
      "quality-e2e.yml",
      "release.yml",
    ]

    for (const workflowName of workflowNames) {
      const workflow = readWorkflow(workflowName)
      const externalActions = [
        ...workflow.matchAll(
          /uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)/g
        ),
      ]

      for (const [, action, reference] of externalActions) {
        expect(reference, `${workflowName}: ${action}`).toMatch(
          /^[0-9a-f]{40}$/
        )
      }

      const checkoutCount = externalActions.filter(
        ([, action]) => action === "actions/checkout"
      ).length
      const disabledCredentialCount = (
        workflow.match(/persist-credentials:\s*false/g) ?? []
      ).length
      expect(disabledCredentialCount, workflowName).toBe(checkoutCount)
    }
  })

  it("verifies and publishes the same resolved release ref", () => {
    const qualityWorkflow = readWorkflow("quality-e2e.yml")
    const releaseWorkflow = readWorkflow("release.yml")
    const ciWorkflow = readWorkflow("ci.yml")

    expect(qualityWorkflow).toContain("checkout_ref:")
    expect(
      qualityWorkflow.match(/ref:\s*\$\{\{\s*inputs\.checkout_ref\s*\}\}/g)
    ).toHaveLength(2)

    expect(releaseWorkflow).toContain(
      "checkout_sha: ${{ steps.resolve.outputs.checkout_sha }}"
    )
    expect(releaseWorkflow).toContain(
      "checkout_ref: ${{ needs.resolve.outputs.checkout_sha }}"
    )
    expect(releaseWorkflow).toContain(
      "ref: ${{ needs.resolve.outputs.checkout_sha }}"
    )
    expect(releaseWorkflow).not.toContain(
      "ref: ${{ inputs.release_tag || github.ref }}"
    )
    expect(ciWorkflow).toContain("checkout_ref: ${{ github.sha }}")
  })

  it("requires the release tag, package version, and packaged manifest to match", () => {
    const releaseWorkflow = readWorkflow("release.yml")

    expect(releaseWorkflow).toContain('$expectedTag = "v$packageVersion"')
    expect(releaseWorkflow).toContain("if ($env:RELEASE_TAG -cne $expectedTag)")
    expect(releaseWorkflow).toContain(
      "if ($manifestVersion -cne $packageVersion)"
    )

    const buildIndex = releaseWorkflow.indexOf("run: pnpm zip")
    const manifestValidationIndex = releaseWorkflow.indexOf(
      "if ($manifestVersion -cne $packageVersion)"
    )
    expect(buildIndex).toBeGreaterThan(-1)
    expect(manifestValidationIndex).toBeGreaterThan(buildIndex)
  })

  it("uploads a replacement before removing the published asset and publishes only after upload", () => {
    const releaseWorkflow = readWorkflow("release.yml")

    expect(releaseWorkflow).toContain("draft: true")
    expect(releaseWorkflow).toContain("const uploadedAsset =")

    const uploadIndex = releaseWorkflow.indexOf("const uploadedAsset =")
    const deleteIndex = releaseWorkflow.indexOf(
      "'DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}'"
    )
    const renameIndex = releaseWorkflow.indexOf(
      "'PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}'"
    )
    const publishIndex = releaseWorkflow.indexOf("draft: false")

    expect(uploadIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(uploadIndex)
    expect(renameIndex).toBeGreaterThan(deleteIndex)
    expect(publishIndex).toBeGreaterThan(renameIndex)
  })
})
