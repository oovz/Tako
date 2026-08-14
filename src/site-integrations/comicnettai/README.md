# Comic Nettai

Comic Nettai uses viewer-session HTML and API data together with PUBLUS
configuration and image reconstruction.

## Runtime contract

- Background: viewer-page series resolution.
- Offscreen: PUBLUS chapter planning and integrated tile reconstruction.
- Page probe: none.
- Dispatch context: none.
- DNR: none.

Endpoint IDs are `comicnettai-viewer-page`, `comicnettai-viewer-api`,
`comicnettai-cdn-config`, and `comicnettai-cdn-image`. Production network calls
must use the shared endpoint client. The external PUBLUS payload codec lives in
`contracts/publus.ts`.

The checked contract fixture is `fixtures/contract.json`. Provider tests cover
viewer/config drift, allocation and grid limits, metadata-bearing transport
URLs, and reconstructed image output.
