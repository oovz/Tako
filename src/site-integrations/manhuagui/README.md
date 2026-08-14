# Manhuagui

Manhuagui resolves series and chapters from fetched HTML and its packaged-reader
configuration. Reader HTML uses the browser session; configuration and image
traffic are anonymous.

## Runtime contract

- Background: series HTML resolution plus optional adult-gate page enrichment.
- Offscreen: packed-reader chapter planning and direct image download; no image
  transform.
- Page probe: optional, strictly decoded by `contracts/page-probe.ts`.
- Dispatch context: none.
- DNR: referer rule `41002` for declared Hamreus image hosts.

Endpoint IDs are `manhuagui-series-html`, `manhuagui-reader-config`, and
`manhuagui-image-cdn`. Production network calls must use the shared endpoint
client.

The checked contract fixture is `fixtures/contract.json`. Provider tests cover
hostile packed-reader data, adult-gate enrichment, reader-host selection, DNR
policy, and image download behavior.
