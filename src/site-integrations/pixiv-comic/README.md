# Pixiv Comic

Pixiv Comic uses private application endpoints and the browser session. Its
build ID, request signing, image keys, and transform contract require dedicated
provider test coverage to safeguard against upstream changes.

## Runtime contract

- Background: private API series resolution and task-scoped dispatch data.
- Offscreen: private episode planning, signed image download, and integrated
  grid descrambling.
- Page probe: none.
- Dispatch context: optional schema version 1, decoded by
  `contracts/dispatch-context.ts`.
- DNR: referer rule `41001` for the declared Pixiv image host.

Endpoint IDs are `pixiv-comic-homepage`, `pixiv-comic-works-api`,
`pixiv-comic-episodes-api`, and `pixiv-comic-image-cdn`. Production network
calls must use the shared endpoint client.

The checked contract fixture is `fixtures/contract.json`. Provider tests cover
build-ID refresh, request signing, strict context admission, URL trust, image
keys, and pixel reconstruction.
