# MANGA Plus fixtures

`title-page.html` retains the public title header and metadata captured on 2026-10-25 from [Home at the Horizon](https://mangaplus.shueisha.co.jp/titles/100467).

`contract.json` projects the captured title's 14 chapter entries and the viewer's 23 manga pages plus three non-manga records. Signed URL values, viewer tokens, and image keys are synthetic. Browser image responses contain controlled PNG data encrypted with the fixture key, allowing tests to exercise headers, page selection, XOR reconstruction, and failure cases.
