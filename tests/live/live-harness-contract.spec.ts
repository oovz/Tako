import { test, expect } from "../e2e/fixtures/extension"
import { SITE_INTEGRATION_MANIFESTS } from "../../src/site-integrations/manifest"

test("live profile pre-grants broad HTTPS access and enables every shipped integration", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  })

  const harnessState = await page.evaluate(async () => {
    const storage = await chrome.storage.local.get("siteIntegrationEnablement")
    const hasWildcardPermission = await chrome.permissions.contains({
      origins: ["https://*/*"],
    })
    return {
      hasWildcardPermission,
      enablement: storage.siteIntegrationEnablement,
    }
  })

  const shippedIds = SITE_INTEGRATION_MANIFESTS.filter(
    (manifest) => manifest.shipped
  ).map((manifest) => manifest.id)

  expect(harnessState.hasWildcardPermission).toBe(true)
  expect(harnessState.enablement).toEqual(
    Object.fromEntries(shippedIds.map((id) => [id, true]))
  )

  await page.close()
})
