function encodeVarint(val: number): number[] {
  let v = val
  const bytes: number[] = []
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v & 0x7f)
  return bytes
}

function encodeField(
  tag: number,
  wireType: number,
  payload: number[]
): number[] {
  const header = encodeVarint((tag << 3) | wireType)
  if (wireType === 2) {
    const len = encodeVarint(payload.length)
    return [...header, ...len, ...payload]
  }
  return [...header, ...payload]
}

function encodeString(tag: number, str: string): number[] {
  return encodeField(tag, 2, Array.from(new TextEncoder().encode(str)))
}

function encodeInt32(tag: number, val: number): number[] {
  return encodeField(tag, 0, encodeVarint(val))
}

function encodeMessage(tag: number, payload: number[]): number[] {
  return encodeField(tag, 2, payload)
}

export function buildMangaMillionRegisterResponse(
  token = "mock-device-token-12345"
): Buffer {
  const tokenPayload = encodeString(1, token)
  const bytes = [
    ...encodeInt32(1, 0), // status = 0 (OK)
    ...encodeMessage(170, tokenPayload), // deviceTokenRegister
  ]
  return Buffer.from(bytes)
}

export interface BuildTitleDetailOptions {
  title?: string
  author?: string
  coverUrl?: string
  description?: string
}

export function buildMangaMillionTitleDetailResponse(
  options: BuildTitleDetailOptions = {}
): Buffer {
  const title = options.title ?? "One Piece"
  const author = options.author ?? "Eiichiro Oda"
  const coverUrl =
    options.coverUrl ??
    "https://img.mangamillion.shueisha.co.jp/jpn/image/original_title_cover/1.webp"
  const description =
    options.description ?? "The story of Monkey D. Luffy and his pirate crew."

  const serviceTitleBytes = [
    ...encodeString(1, coverUrl),
    ...encodeString(2, title),
    ...encodeString(3, author),
    ...encodeString(7, description),
  ]

  const titleDetailBytes = [...encodeMessage(1, serviceTitleBytes)]

  const bytes = [
    ...encodeInt32(1, 0), // status = 0 (OK)
    ...encodeMessage(50, titleDetailBytes), // titleDetail
  ]
  return Buffer.from(bytes)
}

export interface MockChapterItem {
  number: string
  name: string
  translatedChapterId?: number
}

export interface MockChapterGroupItem {
  groupType?: number
  chapters: MockChapterItem[]
}

export function buildMangaMillionChapterListResponse(
  input: MockChapterItem[] | MockChapterGroupItem[] = [
    {
      number: "#001",
      name: "Chapter 1:Romance Dawn",
      translatedChapterId: 6736,
    },
    {
      number: "#002",
      name: "Chapter 2:They Call Him “Straw Hat Luffy”",
      translatedChapterId: 6739,
    },
    {
      number: "#003",
      name: "Chapter 3:Enter Zolo: Pirate Hunter",
      translatedChapterId: 6742,
    },
  ]
): Buffer {
  const isGroupList =
    input.length > 0 &&
    "chapters" in input[0] &&
    Array.isArray((input[0] as MockChapterGroupItem).chapters)
  const groups: MockChapterGroupItem[] = isGroupList
    ? (input as MockChapterGroupItem[])
    : [{ groupType: 0, chapters: input as MockChapterItem[] }]

  const allGroupsBytes: number[] = []
  let totalChapters = 0

  for (const group of groups) {
    const groupChaptersBytes: number[] = []
    for (const ch of group.chapters) {
      totalChapters++
      const chInfoBytes = [
        ...encodeString(1, ch.number),
        ...encodeString(2, ch.name),
        ...(ch.translatedChapterId !== undefined
          ? encodeInt32(3, ch.translatedChapterId)
          : []),
      ]
      groupChaptersBytes.push(...encodeMessage(2, chInfoBytes))
    }

    const groupBytes = [
      ...encodeInt32(1, group.groupType ?? 0),
      ...groupChaptersBytes,
    ]
    allGroupsBytes.push(...encodeMessage(2, groupBytes))
  }

  const chapterListBytes = [...encodeInt32(1, totalChapters), ...allGroupsBytes]

  const bytes = [
    ...encodeInt32(1, 0), // status = 0 (OK)
    ...encodeMessage(60, chapterListBytes), // chapterList
  ]
  return Buffer.from(bytes)
}

export interface BuildViewerOptions {
  aesKey?: string
  aesIv?: string
  pageUrls?: string[]
}

export function buildMangaMillionViewerResponse(
  options: BuildViewerOptions = {}
): Buffer {
  const aesKey =
    options.aesKey ??
    "8c12434255319a2a5fb903fc39994f409eb27979d1d78f1009f1a015f69db321"
  const aesIv = options.aesIv ?? "4af66d450c1244868dc4a5cff035898c"
  const pageUrls = options.pageUrls ?? [
    "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/1.webp.enc",
    "https://img.mangamillion.shueisha.co.jp/en/translated_chapter_page/6736/2.webp.enc",
  ]

  const pagesBytes: number[] = []
  for (const url of pageUrls) {
    const pageItemBytes = [
      ...encodeString(1, url),
      ...encodeInt32(2, 1080),
      ...encodeInt32(3, 1620),
    ]
    pagesBytes.push(...encodeMessage(1, pageItemBytes))
  }

  const viewerBytes = [
    ...pagesBytes,
    ...encodeString(7, aesKey),
    ...encodeString(8, aesIv),
  ]

  const bytes = [
    ...encodeInt32(1, 0), // status = 0 (OK)
    ...encodeMessage(70, viewerBytes), // viewer
  ]
  return Buffer.from(bytes)
}
