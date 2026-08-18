export class ProtoReader {
  public pos = 0
  public readonly len: number
  private readonly buf: Uint8Array
  private readonly decoder = new TextDecoder()

  constructor(buf: ArrayBuffer | Uint8Array) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    this.len = this.buf.length
  }

  static create(buf: ArrayBuffer | Uint8Array): ProtoReader {
    return new ProtoReader(buf)
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
    while (this.pos < this.len && this.buf[this.pos++] & 0x80) {
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
    const str = this.decoder.decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return str
  }

  skipType(wireType: number): void {
    switch (wireType) {
      case 0:
        while (this.pos < this.len && this.buf[this.pos++] & 0x80) {
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
        throw new Error(`Unsupported Protobuf wire type: ${wireType}`)
    }
  }
}

export interface MangaMillionChapterInfo {
  number?: string
  name?: string
  translatedChapterId?: number
  commentCount?: number
  thumbnailUrl?: string
  read?: boolean
}

export interface MangaMillionChapterGroup {
  groupType?: number
  chapters?: MangaMillionChapterInfo[]
}

export interface MangaMillionChapterList {
  totalChapters?: number
  chapterGroups?: MangaMillionChapterGroup[]
  isMPlusRegion?: boolean
  availableChapters?: number
}

export interface MangaMillionServiceTitle {
  coverUrl?: string
  serviceTitleName?: string
  authorName?: string
  description?: string
  disclaimerText?: string
}

export interface MangaMillionTitleDetail {
  serviceTitle?: MangaMillionServiceTitle
  isMPlusRegion?: boolean
}

export interface MangaMillionViewerPage {
  imageUrl?: string
  widthPx?: number
  heightPx?: number
  pageType?: number
}

export interface MangaMillionViewerChapter {
  serviceTitleName?: string
  originalTitleId?: number
  number?: string
  prevId?: number
  nextId?: number
  commentCount?: number
}

export interface MangaMillionViewer {
  pages?: MangaMillionViewerPage[]
  chapter?: MangaMillionViewerChapter
  aesKey?: string
  aesIv?: string
  maxImageQuality?: number
}

export interface MangaMillionDeviceTokenRegister {
  token?: string
}

export interface MangaMillionResponse {
  status: number
  errorMessage?: string
  deviceTokenRegister?: MangaMillionDeviceTokenRegister
  titleDetail?: MangaMillionTitleDetail
  chapterList?: MangaMillionChapterList
  viewer?: MangaMillionViewer
}

function decodeDeviceTokenRegister(
  r: ProtoReader,
  len: number
): MangaMillionDeviceTokenRegister {
  const end = r.pos + len
  const res: MangaMillionDeviceTokenRegister = {}
  while (r.pos < end) {
    const tag = r.uint32()
    if (tag >>> 3 === 1) {
      res.token = r.string()
    } else {
      r.skipType(tag & 7)
    }
  }
  return res
}

function decodeServiceTitle(
  r: ProtoReader,
  len: number
): MangaMillionServiceTitle {
  const end = r.pos + len
  const res: MangaMillionServiceTitle = {}
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.coverUrl = r.string()
        break
      case 2:
        res.serviceTitleName = r.string()
        break
      case 3:
        res.authorName = r.string()
        break
      case 7:
        res.description = r.string()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeTitleDetail(
  r: ProtoReader,
  len: number
): MangaMillionTitleDetail {
  const end = r.pos + len
  const res: MangaMillionTitleDetail = {}
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.serviceTitle = decodeServiceTitle(r, r.uint32())
        break
      case 5:
        res.isMPlusRegion = r.bool()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeChapterInfo(
  r: ProtoReader,
  len: number
): MangaMillionChapterInfo {
  const end = r.pos + len
  const res: MangaMillionChapterInfo = {}
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.number = r.string()
        break
      case 2:
        res.name = r.string()
        break
      case 3:
        res.translatedChapterId = r.uint32()
        break
      case 4:
        res.commentCount = r.uint32()
        break
      case 5:
        res.thumbnailUrl = r.string()
        break
      case 6:
        res.read = r.bool()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeChapterGroup(
  r: ProtoReader,
  len: number
): MangaMillionChapterGroup {
  const end = r.pos + len
  const res: MangaMillionChapterGroup = { chapters: [] }
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.groupType = r.int32()
        break
      case 2:
        res.chapters?.push(decodeChapterInfo(r, r.uint32()))
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeChapterList(
  r: ProtoReader,
  len: number
): MangaMillionChapterList {
  const end = r.pos + len
  const res: MangaMillionChapterList = { chapterGroups: [] }
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.totalChapters = r.uint32()
        break
      case 2:
        res.chapterGroups?.push(decodeChapterGroup(r, r.uint32()))
        break
      case 3:
        res.isMPlusRegion = r.bool()
        break
      case 7:
        res.availableChapters = r.uint32()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeViewerPage(r: ProtoReader, len: number): MangaMillionViewerPage {
  const end = r.pos + len
  const res: MangaMillionViewerPage = {}
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.imageUrl = r.string()
        break
      case 2:
        res.widthPx = r.uint32()
        break
      case 3:
        res.heightPx = r.uint32()
        break
      case 4:
        res.pageType = r.int32()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeViewerChapter(
  r: ProtoReader,
  len: number
): MangaMillionViewerChapter {
  const end = r.pos + len
  const res: MangaMillionViewerChapter = {}
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.serviceTitleName = r.string()
        break
      case 2:
        res.originalTitleId = r.uint32()
        break
      case 4:
        res.number = r.string()
        break
      case 5:
        res.prevId = r.uint32()
        break
      case 6:
        res.nextId = r.uint32()
        break
      case 7:
        res.commentCount = r.uint32()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

function decodeViewer(r: ProtoReader, len: number): MangaMillionViewer {
  const end = r.pos + len
  const res: MangaMillionViewer = { pages: [] }
  while (r.pos < end) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.pages?.push(decodeViewerPage(r, r.uint32()))
        break
      case 2:
        res.chapter = decodeViewerChapter(r, r.uint32())
        break
      case 7:
        res.aesKey = r.string()
        break
      case 8:
        res.aesIv = r.string()
        break
      case 9:
        res.maxImageQuality = r.int32()
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}

export function decodeMangaMillionResponse(
  buffer: ArrayBuffer | Uint8Array
): MangaMillionResponse {
  const r = ProtoReader.create(buffer)
  const res: MangaMillionResponse = { status: 0 }
  while (r.pos < r.len) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 1:
        res.status = r.int32()
        break
      case 2:
        res.errorMessage = r.string()
        break
      case 50:
        res.titleDetail = decodeTitleDetail(r, r.uint32())
        break
      case 60:
        res.chapterList = decodeChapterList(r, r.uint32())
        break
      case 70:
        res.viewer = decodeViewer(r, r.uint32())
        break
      case 170:
        res.deviceTokenRegister = decodeDeviceTokenRegister(r, r.uint32())
        break
      default:
        r.skipType(tag & 7)
    }
  }
  return res
}
