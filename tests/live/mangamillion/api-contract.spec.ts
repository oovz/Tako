import { test, expect } from "../../e2e/fixtures/extension"

const TITLE_ID = "1"
const CANARY_CHAPTER_ID = "6736"

test.describe("MangaMillion API contract (live)", () => {
  test.describe.configure({ timeout: 60_000 })

  test("device registration, title detail, chapter list, and viewer decryption pipeline", async ({
    context,
  }) => {
    const page = await context.newPage()
    try {
      await page.goto("https://mangamillion.shueisha.co.jp/en", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      })

      const result = await page.evaluate(
        async ({ titleId, chapterId }) => {
          class ProtoReader {
            public pos = 0
            public readonly len: number
            public readonly buf: Uint8Array
            public readonly decoder = new TextDecoder()

            constructor(buf: ArrayBuffer | Uint8Array) {
              this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
              this.len = this.buf.length
            }
            uint32(): number {
              let b = this.buf[this.pos++]
              let res = b & 0x7f
              if (!(b & 0x80)) return res >>> 0
              b = this.buf[this.pos++]
              res |= (b & 0x7f) << 7
              if (!(b & 0x80)) return res >>> 0
              b = this.buf[this.pos++]
              res |= (b & 0x7f) << 14
              if (!(b & 0x80)) return res >>> 0
              b = this.buf[this.pos++]
              res |= (b & 0x7f) << 21
              if (!(b & 0x80)) return res >>> 0
              b = this.buf[this.pos++]
              res |= (b & 0x0f) << 28
              if (!(b & 0x80)) return res >>> 0
              while (this.buf[this.pos++] & 0x80) {
                continue
              }
              return res >>> 0
            }
            int32(): number {
              return this.uint32() | 0
            }
            bool(): boolean {
              return this.uint32() !== 0
            }
            string(): string {
              const len = this.uint32()
              const str = this.decoder.decode(
                this.buf.subarray(this.pos, this.pos + len)
              )
              this.pos += len
              return str
            }
            skipType(wireType: number): void {
              switch (wireType) {
                case 0:
                  while (this.buf[this.pos++] & 0x80) {
                    continue
                  }
                  break
                case 1:
                  this.pos += 8
                  break
                case 2: {
                  const len = this.uint32()
                  this.pos += len
                  break
                }
                case 5:
                  this.pos += 4
                  break
                default:
                  throw new Error("Unsupported wire type: " + wireType)
              }
            }
          }

          // 1. Device Registration
          const regRes = await fetch(
            "https://api.mangamillion.shueisha.co.jp/api/register",
            {
              method: "POST",
              credentials: "omit",
            }
          )
          if (!regRes.ok)
            throw new Error(`Register failed: HTTP ${regRes.status}`)
          const regBuf = await regRes.arrayBuffer()
          const regR = new ProtoReader(regBuf)
          let token = ""
          while (regR.pos < regR.len) {
            const tag = regR.uint32()
            if (tag >>> 3 === 170) {
              const end = regR.pos + regR.uint32()
              while (regR.pos < end) {
                const subTag = regR.uint32()
                if (subTag >>> 3 === 1) token = regR.string()
                else regR.skipType(subTag & 7)
              }
            } else {
              regR.skipType(tag & 7)
            }
          }

          if (!token)
            throw new Error("No token returned from device registration")

          // 2. Title Detail
          const titleRes = await fetch(
            `https://api.mangamillion.shueisha.co.jp/api/title_detail?original_title_id=${titleId}&service_language=en&avif_enable=false`,
            { headers: { "Access-Token": token }, credentials: "omit" }
          )
          if (!titleRes.ok)
            throw new Error(`Title detail failed: HTTP ${titleRes.status}`)
          const titleBuf = await titleRes.arrayBuffer()
          const titleR = new ProtoReader(titleBuf)
          let seriesTitle = ""
          let authorName = ""
          while (titleR.pos < titleR.len) {
            const tag = titleR.uint32()
            if (tag >>> 3 === 50) {
              const end = titleR.pos + titleR.uint32()
              while (titleR.pos < end) {
                const subTag = titleR.uint32()
                if (subTag >>> 3 === 1) {
                  const sEnd = titleR.pos + titleR.uint32()
                  while (titleR.pos < sEnd) {
                    const sTag = titleR.uint32()
                    if (sTag >>> 3 === 2) seriesTitle = titleR.string()
                    else if (sTag >>> 3 === 3) authorName = titleR.string()
                    else titleR.skipType(sTag & 7)
                  }
                } else {
                  titleR.skipType(subTag & 7)
                }
              }
            } else {
              titleR.skipType(tag & 7)
            }
          }

          // 3. Chapter List
          const chapterRes = await fetch(
            `https://api.mangamillion.shueisha.co.jp/api/chapter_list?original_title_id=${titleId}&translated_language=en&service_language=en&avif_enable=false`,
            { headers: { "Access-Token": token }, credentials: "omit" }
          )
          if (!chapterRes.ok)
            throw new Error(`Chapter list failed: HTTP ${chapterRes.status}`)
          const chapterBuf = await chapterRes.arrayBuffer()
          const chapterR = new ProtoReader(chapterBuf)
          let chapterCount = 0
          let firstChapterId = 0
          while (chapterR.pos < chapterR.len) {
            const tag = chapterR.uint32()
            if (tag >>> 3 === 60) {
              const end = chapterR.pos + chapterR.uint32()
              while (chapterR.pos < end) {
                const subTag = chapterR.uint32()
                if (subTag >>> 3 === 1) chapterCount = chapterR.uint32()
                else if (subTag >>> 3 === 2) {
                  const gEnd = chapterR.pos + chapterR.uint32()
                  while (chapterR.pos < gEnd) {
                    const gTag = chapterR.uint32()
                    if (gTag >>> 3 === 2) {
                      const cEnd = chapterR.pos + chapterR.uint32()
                      while (chapterR.pos < cEnd) {
                        const cTag = chapterR.uint32()
                        if (cTag >>> 3 === 3 && firstChapterId === 0)
                          firstChapterId = chapterR.uint32()
                        else chapterR.skipType(cTag & 7)
                      }
                    } else {
                      chapterR.skipType(gTag & 7)
                    }
                  }
                } else {
                  chapterR.skipType(subTag & 7)
                }
              }
            } else {
              chapterR.skipType(tag & 7)
            }
          }

          // 4. Viewer
          const viewerRes = await fetch(
            `https://api.mangamillion.shueisha.co.jp/api/viewer?translated_chapter_id=${chapterId}&quality=middle&service_language=en&avif_enable=false`,
            { headers: { "Access-Token": token }, credentials: "omit" }
          )
          if (!viewerRes.ok)
            throw new Error(`Viewer failed: HTTP ${viewerRes.status}`)
          const viewerBuf = await viewerRes.arrayBuffer()
          const viewerR = new ProtoReader(viewerBuf)
          let aesKey = ""
          let aesIv = ""
          let firstPageUrl = ""
          while (viewerR.pos < viewerR.len) {
            const tag = viewerR.uint32()
            if (tag >>> 3 === 70) {
              const end = viewerR.pos + viewerR.uint32()
              while (viewerR.pos < end) {
                const subTag = viewerR.uint32()
                if (subTag >>> 3 === 1 && !firstPageUrl) {
                  const pEnd = viewerR.pos + viewerR.uint32()
                  while (viewerR.pos < pEnd) {
                    const pTag = viewerR.uint32()
                    if (pTag >>> 3 === 1) firstPageUrl = viewerR.string()
                    else viewerR.skipType(pTag & 7)
                  }
                } else if (subTag >>> 3 === 7) aesKey = viewerR.string()
                else if (subTag >>> 3 === 8) aesIv = viewerR.string()
                else viewerR.skipType(subTag & 7)
              }
            } else {
              viewerR.skipType(tag & 7)
            }
          }

          // 5. Image Download and AES Decryption
          const imgRes = await fetch(firstPageUrl, { credentials: "omit" })
          if (!imgRes.ok)
            throw new Error(`Image download failed: HTTP ${imgRes.status}`)
          const encryptedBuffer = await imgRes.arrayBuffer()

          const hexToBytes = (hex: string) => {
            const matches = hex.match(/.{1,2}/g) || []
            const arr = new Uint8Array(matches.length)
            for (let i = 0; i < matches.length; i++) {
              arr[i] = parseInt(matches[i], 16)
            }
            return arr
          }
          const keyBytes = hexToBytes(aesKey)
          const ivBytes = hexToBytes(aesIv)

          const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
          )
          const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: ivBytes },
            cryptoKey,
            encryptedBuffer
          )

          const decryptedBytes = new Uint8Array(decryptedBuffer)
          const isWebp =
            decryptedBytes[0] === 0x52 &&
            decryptedBytes[1] === 0x49 &&
            decryptedBytes[2] === 0x46 &&
            decryptedBytes[3] === 0x46 &&
            decryptedBytes[8] === 0x57 &&
            decryptedBytes[9] === 0x45 &&
            decryptedBytes[10] === 0x42 &&
            decryptedBytes[11] === 0x50

          return {
            hasToken: !!token,
            seriesTitle,
            authorName,
            chapterCount,
            firstChapterId,
            hasAesKey: aesKey.length === 64,
            hasAesIv: aesIv.length === 32,
            hasPageUrl: firstPageUrl.startsWith(
              "https://img.mangamillion.shueisha.co.jp"
            ),
            decryptedByteLength: decryptedBuffer.byteLength,
            isWebp,
          }
        },
        { titleId: TITLE_ID, chapterId: CANARY_CHAPTER_ID }
      )

      expect(result.hasToken).toBe(true)
      expect(result.seriesTitle).toBe("One Piece")
      expect(result.authorName).toBe("Eiichiro Oda")
      expect(result.chapterCount).toBeGreaterThan(0)
      expect(result.firstChapterId).toBeGreaterThan(0)
      expect(result.hasAesKey).toBe(true)
      expect(result.hasAesIv).toBe(true)
      expect(result.hasPageUrl).toBe(true)
      expect(result.decryptedByteLength).toBeGreaterThan(0)
      expect(result.isWebp).toBe(true)
    } finally {
      await page.close()
    }
  })
  test("title 10 (Dandadan) resolution with multi-language and unique locked chapter IDs", async ({
    context,
  }) => {
    const page = await context.newPage()
    try {
      await page.goto("https://mangamillion.shueisha.co.jp/en", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      })

      const result = await page.evaluate(async () => {
        class ProtoReader {
          public pos = 0
          public readonly len: number
          public readonly buf: Uint8Array
          public readonly decoder = new TextDecoder()

          constructor(buf: ArrayBuffer | Uint8Array) {
            this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
            this.len = this.buf.length
          }
          uint32(): number {
            let b = this.buf[this.pos++]
            let res = b & 0x7f
            if (!(b & 0x80)) return res >>> 0
            b = this.buf[this.pos++]
            res |= (b & 0x7f) << 7
            if (!(b & 0x80)) return res >>> 0
            b = this.buf[this.pos++]
            res |= (b & 0x7f) << 14
            if (!(b & 0x80)) return res >>> 0
            b = this.buf[this.pos++]
            res |= (b & 0x7f) << 21
            if (!(b & 0x80)) return res >>> 0
            b = this.buf[this.pos++]
            res |= (b & 0x0f) << 28
            if (!(b & 0x80)) return res >>> 0
            while (this.buf[this.pos++] & 0x80) {
              continue
            }
            return res >>> 0
          }
          int32(): number {
            return this.uint32() | 0
          }
          bool(): boolean {
            return this.uint32() !== 0
          }
          string(): string {
            const len = this.uint32()
            const str = this.decoder.decode(
              this.buf.subarray(this.pos, this.pos + len)
            )
            this.pos += len
            return str
          }
          skipType(wireType: number): void {
            switch (wireType) {
              case 0:
                while (this.buf[this.pos++] & 0x80) {
                  continue
                }
                break
              case 1:
                this.pos += 8
                break
              case 2: {
                const len = this.uint32()
                this.pos += len
                break
              }
              case 5:
                this.pos += 4
                break
              default:
                throw new Error("Unsupported wire type: " + wireType)
            }
          }
        }

        // 1. Device Registration
        const regRes = await fetch(
          "https://api.mangamillion.shueisha.co.jp/api/register",
          {
            method: "POST",
            credentials: "omit",
          }
        )
        if (!regRes.ok)
          throw new Error(`Register failed: HTTP ${regRes.status}`)
        const regBuf = await regRes.arrayBuffer()
        const regR = new ProtoReader(regBuf)
        let token = ""
        while (regR.pos < regR.len) {
          const tag = regR.uint32()
          if (tag >>> 3 === 170) {
            const end = regR.pos + regR.uint32()
            while (regR.pos < end) {
              const subTag = regR.uint32()
              if (subTag >>> 3 === 1) token = regR.string()
              else regR.skipType(subTag & 7)
            }
          } else {
            regR.skipType(tag & 7)
          }
        }

        // 2. Title Detail (English)
        const titleRes = await fetch(
          "https://api.mangamillion.shueisha.co.jp/api/title_detail?original_title_id=10&service_language=en&avif_enable=false",
          { headers: { "Access-Token": token }, credentials: "omit" }
        )
        if (!titleRes.ok)
          throw new Error(`Title detail failed: HTTP ${titleRes.status}`)
        const titleBuf = await titleRes.arrayBuffer()
        const titleR = new ProtoReader(titleBuf)
        let seriesTitle = ""
        let authorName = ""
        while (titleR.pos < titleR.len) {
          const tag = titleR.uint32()
          if (tag >>> 3 === 50) {
            const end = titleR.pos + titleR.uint32()
            while (titleR.pos < end) {
              const subTag = titleR.uint32()
              if (subTag >>> 3 === 1) {
                const sEnd = titleR.pos + titleR.uint32()
                while (titleR.pos < sEnd) {
                  const sTag = titleR.uint32()
                  if (sTag >>> 3 === 2) seriesTitle = titleR.string()
                  else if (sTag >>> 3 === 3) authorName = titleR.string()
                  else titleR.skipType(sTag & 7)
                }
              } else {
                titleR.skipType(subTag & 7)
              }
            }
          } else {
            titleR.skipType(tag & 7)
          }
        }

        // 3. Chapter List (English)
        const chapterRes = await fetch(
          "https://api.mangamillion.shueisha.co.jp/api/chapter_list?original_title_id=10&translated_language=en&service_language=en&avif_enable=false",
          { headers: { "Access-Token": token }, credentials: "omit" }
        )
        if (!chapterRes.ok)
          throw new Error(`Chapter list failed: HTTP ${chapterRes.status}`)
        const chapterBuf = await chapterRes.arrayBuffer()
        const chR = new ProtoReader(chapterBuf)

        interface RawCh {
          number?: string
          name?: string
          translatedChapterId?: number
        }
        interface RawGroup {
          groupType?: number
          chapters: RawCh[]
        }

        const groups: RawGroup[] = []
        while (chR.pos < chR.len) {
          const tag = chR.uint32()
          if (tag >>> 3 === 60) {
            const end = chR.pos + chR.uint32()
            while (chR.pos < end) {
              const subTag = chR.uint32()
              if (subTag >>> 3 === 2) {
                const gEnd = chR.pos + chR.uint32()
                const grp: RawGroup = { chapters: [] }
                while (chR.pos < gEnd) {
                  const gTag = chR.uint32()
                  if (gTag >>> 3 === 1) {
                    grp.groupType = chR.int32()
                  } else if (gTag >>> 3 === 2) {
                    const cEnd = chR.pos + chR.uint32()
                    const chItem: RawCh = {}
                    while (chR.pos < cEnd) {
                      const cTag = chR.uint32()
                      if (cTag >>> 3 === 1) chItem.number = chR.string()
                      else if (cTag >>> 3 === 2) chItem.name = chR.string()
                      else if (cTag >>> 3 === 3)
                        chItem.translatedChapterId = chR.uint32()
                      else chR.skipType(cTag & 7)
                    }
                    grp.chapters.push(chItem)
                  } else {
                    chR.skipType(gTag & 7)
                  }
                }
                groups.push(grp)
              } else {
                chR.skipType(subTag & 7)
              }
            }
          } else {
            chR.skipType(tag & 7)
          }
        }

        const constructedIds: string[] = []
        const seenIds = new Set<string>()
        let chapterIndex = 0
        let lockedCount = 0
        let freeCount = 0

        for (const group of groups) {
          const isGroupUnavailable =
            group.groupType === 1 || group.groupType === 3
          for (const ch of group.chapters) {
            chapterIndex++
            const translatedChapterId = ch.translatedChapterId ?? 0
            const isLocked = isGroupUnavailable || translatedChapterId === 0
            if (isLocked) lockedCount++
            else freeCount++

            const rawNumber = ch.number ?? ""
            const cleanNumber = rawNumber.replace(/^#/, "")
            let id =
              translatedChapterId > 0
                ? String(translatedChapterId)
                : cleanNumber
                  ? `locked-${cleanNumber}`
                  : `locked-${chapterIndex}`
            if (seenIds.has(id)) {
              id = `${id}-${chapterIndex}`
            }
            seenIds.add(id)
            constructedIds.push(id)
          }
        }

        // 4. Title Detail (Simplified Chinese)
        const zhTitleRes = await fetch(
          "https://api.mangamillion.shueisha.co.jp/api/title_detail?original_title_id=10&service_language=zh-CN&avif_enable=false",
          { headers: { "Access-Token": token }, credentials: "omit" }
        )
        const zhTitleOk = zhTitleRes.ok

        return {
          seriesTitle,
          authorName,
          groupCount: groups.length,
          totalChapters: constructedIds.length,
          uniqueIdCount: new Set(constructedIds).size,
          freeCount,
          lockedCount,
          zhTitleOk,
        }
      })

      expect(result.seriesTitle).toBe("Dandadan")
      expect(result.authorName).toBe("Yukinobu Tatsu")
      expect(result.groupCount).toBeGreaterThanOrEqual(2)
      expect(result.totalChapters).toBeGreaterThanOrEqual(30)
      expect(result.freeCount).toBeGreaterThan(0)
      expect(result.lockedCount).toBeGreaterThan(0)
      expect(result.uniqueIdCount).toBe(result.totalChapters)
      expect(result.zhTitleOk).toBe(true)
    } finally {
      await page.close()
    }
  })
})
