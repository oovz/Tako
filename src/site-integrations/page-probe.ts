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

  const injection = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "ISOLATED",
    injectImmediately: true,
    func: probe.collect,
  })
  return probe.parse(injection[0]?.result)
}
