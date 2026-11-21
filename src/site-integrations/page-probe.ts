import { browser } from "wxt/browser"
import { siteIntegrationPageProbesById } from "@/src/runtime/generated/site-integration-page-probe-registry"
import type { SiteIntegrationPageProbeResult } from "@/src/site-integrations/page-probe-contract"

export async function executeApprovedPageProbe(
  tabId: number,
  integrationId: string
): Promise<SiteIntegrationPageProbeResult> {
  const probe = siteIntegrationPageProbesById[integrationId]
  if (!probe) {
    throw new Error(`No page probe is registered for ${integrationId}`)
  }

  const [frame] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "ISOLATED",
    injectImmediately: true,
    func: probe.collect,
  })
  // Firefox can return a frame error. Chrome can omit the result.
  if (frame?.result === undefined) {
    throw new Error("The top-frame page probe returned no result")
  }
  return probe.parse(frame.result)
}
