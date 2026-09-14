# Shonen Jump+

Shonen Jump+ uses episode HTML and viewer data. Requests are anonymous. Packaged parsing and image transforms run in the offscreen document.

## Runtime contract

- Background: public series and episode resolution.
- Offscreen: episode JSON chapter planning and integrated Gigaviewer descrambling.
- Page probe: none.
- Dispatch context: none.
- DNR: none.

Endpoint IDs are `shonenjumpplus-episode-html`, `shonenjumpplus-viewer-api`, and `shonenjumpplus-image-cdn`. Production network calls must use the shared endpoint client. The external episode payload codec lives in `contracts/episode-json.ts`.

The contract fixture is `fixtures/contract.json`. Provider tests cover malformed episode data, URL trust, access policy, bounds, and pixel-golden reconstruction.
