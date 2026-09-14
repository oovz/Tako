# Pixiv Comic

Pixiv Comic uses private application endpoints and the browser session. Keep provider tests for its build ID, request signing, image keys, and transform behavior because these values can change upstream.

## Runtime contract

- Background: private API series resolution and dispatch data for the queued download.
- Offscreen: private episode planning, signed image download, and integrated grid descrambling.
- Page probe: none.
- Dispatch context: optional schema version 1, decoded by `contracts/dispatch-context.ts`.
- DNR: referer rule `41001` for the declared Pixiv image host.

Endpoint IDs are `pixiv-comic-homepage`, `pixiv-comic-works-api`, `pixiv-comic-episodes-api`, and `pixiv-comic-image-cdn`. Production network calls must use the shared endpoint client.

The contract fixture is `fixtures/contract.json`. Provider tests cover build-ID refresh, request signing, strict context admission, URL trust, image keys, and pixel reconstruction.
