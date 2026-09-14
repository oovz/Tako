# MangaDex

MangaDex uses its official API for series, chapter, and At-Home image-node resolution. API and node requests are anonymous. Provider-issued image origins must pass the endpoint's public-HTTPS policy before use.

## Runtime contract

- Background: official API series resolution and optional page-preference enrichment.
- Offscreen: At-Home chapter planning and image download; no image transform.
- Page probe: optional; decoded by `contracts/page-probe.ts`.
- Dispatch context: optional schema version 1, decoded by `contracts/dispatch-context.ts`.
- DNR: none.

Endpoint IDs are `mangadex-api`, `mangadex-network-report`, and `mangadex-at-home-image`. Production network calls must use the shared endpoint client.

The contract fixture is `fixtures/contract.json`. Provider tests cover API parsing, preference/context handling, provider-issued image-node policy, retry ownership, and download behavior.
