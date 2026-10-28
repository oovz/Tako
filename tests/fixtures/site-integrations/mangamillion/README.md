# MangaMillion fixtures

`series-page.html`, `captured-title.json`, and `captured-chapters.json` retain English One Piece metadata and the first ten visible catalog entries. The captured page reported 108 / 112 chapters, so this fixture represents a bounded catalog sample.

`contract.json` stores logical title, chapter-list, and viewer vectors as JSON. Browser API fixtures encode the captured title and catalog fields into controlled Protobuf envelopes and supply controlled device tokens and encrypted page bytes. The additional language and unavailable-chapter scenario is also controlled test data. This separates captured fields from transport and access-state controls.
