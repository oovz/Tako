import { BinaryReader, WireType } from "@bufbuild/protobuf/wire"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"
import type {
  MangaMillionDeviceToken,
  MangaMillionServiceTitle,
  MangaMillionTitleDetail,
  MangaMillionChapterInfo,
  MangaMillionChapterGroup,
  MangaMillionChapterList,
  MangaMillionViewerPage,
  MangaMillionViewerChapter,
  MangaMillionViewer,
  MangaMillionResponse,
} from "./contracts/api"

// Bound object construction during decoding, including duplicate singular
// messages and chapter entries distributed across multiple groups.
const MAX_RESPONSE_BYTES = 15_000_000
const MAX_MESSAGE_NODES = 20_000
const MAX_COLLECTION_ENTRIES = 10_000
const utf8 = new TextDecoder("utf-8", { fatal: true })
type DecodeBudget = {
  nodes: number
  chapters: number
  groups: number
  pages: number
}

function startMessage(data: Uint8Array, budget: DecodeBudget): BinaryReader {
  if (++budget.nodes > MAX_MESSAGE_NODES) {
    throw new ProviderContractError(
      "MangaMillion Protobuf node budget exceeded"
    )
  }
  return new BinaryReader(data)
}

function requireWireType(actual: WireType, expected: WireType): void {
  if (actual !== expected)
    throw new ProviderContractError("Invalid MangaMillion Protobuf wire type")
}

function readUint32(reader: BinaryReader): number {
  const value = BigInt(reader.uint64())
  if (value > 0xffff_ffffn)
    throw new ProviderContractError("MangaMillion Protobuf uint32 overflow")
  return Number(value)
}

function readDelimited(reader: BinaryReader, data: Uint8Array): Uint8Array {
  const length = readUint32(reader)
  const end = reader.pos + length
  if (end > reader.len)
    throw new ProviderContractError(
      "MangaMillion Protobuf child exceeds message bounds"
    )
  const result = data.subarray(reader.pos, end)
  reader.pos = end
  return result
}

function skipUnknown(
  reader: BinaryReader,
  data: Uint8Array,
  wire: WireType,
  field: number
): void {
  if (wire === WireType.LengthDelimited) {
    readDelimited(reader, data)
    return
  }
  if (wire === WireType.Varint) {
    reader.uint64()
    return
  }
  reader.skip(wire, field, 0)
}

function countEntry(
  budget: DecodeBudget,
  collection: "chapters" | "groups" | "pages"
): void {
  const limit =
    collection === "pages" ? MAX_CHAPTER_IMAGES : MAX_COLLECTION_ENTRIES
  if (++budget[collection] > limit)
    throw new ProviderContractError(
      `MangaMillion Protobuf ${collection} limit exceeded`
    )
}

function decodeDeviceTokenRegister(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionDeviceToken {
  const reader = startMessage(data, budget)
  const result: MangaMillionDeviceToken = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.token = utf8.decode(readDelimited(reader, data))
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeServiceTitle(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionServiceTitle {
  const reader = startMessage(data, budget)
  const result: MangaMillionServiceTitle = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.coverUrl = utf8.decode(readDelimited(reader, data))
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        result.serviceTitleName = utf8.decode(readDelimited(reader, data))
        break
      case 3:
        requireWireType(wire, WireType.LengthDelimited)
        result.authorName = utf8.decode(readDelimited(reader, data))
        break
      case 7:
        requireWireType(wire, WireType.LengthDelimited)
        result.description = utf8.decode(readDelimited(reader, data))
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeTitleDetail(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionTitleDetail {
  const reader = startMessage(data, budget)
  const result: MangaMillionTitleDetail = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.serviceTitle = decodeServiceTitle(
          readDelimited(reader, data),
          budget
        )
        break
      case 5:
        requireWireType(wire, WireType.Varint)
        result.isMPlusRegion = reader.bool()
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeChapterInfo(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionChapterInfo {
  const reader = startMessage(data, budget)
  const result: MangaMillionChapterInfo = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.number = utf8.decode(readDelimited(reader, data))
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        result.name = utf8.decode(readDelimited(reader, data))
        break
      case 3:
        requireWireType(wire, WireType.Varint)
        result.translatedChapterId = readUint32(reader)
        break
      case 4:
        requireWireType(wire, WireType.Varint)
        result.commentCount = readUint32(reader)
        break
      case 5:
        requireWireType(wire, WireType.LengthDelimited)
        result.thumbnailUrl = utf8.decode(readDelimited(reader, data))
        break
      case 6:
        requireWireType(wire, WireType.Varint)
        result.read = reader.bool()
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeChapterGroup(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionChapterGroup {
  const reader = startMessage(data, budget)
  const result: MangaMillionChapterGroup = { chapters: [] }
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.Varint)
        result.groupType = reader.int32()
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        countEntry(budget, "chapters")
        result.chapters!.push(
          decodeChapterInfo(readDelimited(reader, data), budget)
        )
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeChapterList(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionChapterList {
  const reader = startMessage(data, budget)
  const result: MangaMillionChapterList = { chapterGroups: [] }
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.Varint)
        result.totalChapters = readUint32(reader)
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        countEntry(budget, "groups")
        result.chapterGroups!.push(
          decodeChapterGroup(readDelimited(reader, data), budget)
        )
        break
      case 3:
        requireWireType(wire, WireType.Varint)
        result.isMPlusRegion = reader.bool()
        break
      case 7:
        requireWireType(wire, WireType.Varint)
        result.availableChapters = readUint32(reader)
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeViewerPage(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionViewerPage {
  const reader = startMessage(data, budget)
  const result: MangaMillionViewerPage = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.imageUrl = utf8.decode(readDelimited(reader, data))
        break
      case 2:
        requireWireType(wire, WireType.Varint)
        result.widthPx = readUint32(reader)
        break
      case 3:
        requireWireType(wire, WireType.Varint)
        result.heightPx = readUint32(reader)
        break
      case 4:
        requireWireType(wire, WireType.Varint)
        result.pageType = reader.int32()
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeViewerChapter(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionViewerChapter {
  const reader = startMessage(data, budget)
  const result: MangaMillionViewerChapter = {}
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        result.serviceTitleName = utf8.decode(readDelimited(reader, data))
        break
      case 2:
        requireWireType(wire, WireType.Varint)
        result.originalTitleId = readUint32(reader)
        break
      case 4:
        requireWireType(wire, WireType.LengthDelimited)
        result.number = utf8.decode(readDelimited(reader, data))
        break
      case 5:
        requireWireType(wire, WireType.Varint)
        result.prevId = readUint32(reader)
        break
      case 6:
        requireWireType(wire, WireType.Varint)
        result.nextId = readUint32(reader)
        break
      case 7:
        requireWireType(wire, WireType.Varint)
        result.commentCount = readUint32(reader)
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeViewer(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionViewer {
  const reader = startMessage(data, budget)
  const result: MangaMillionViewer = { pages: [] }
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.LengthDelimited)
        countEntry(budget, "pages")
        result.pages!.push(
          decodeViewerPage(readDelimited(reader, data), budget)
        )
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        result.chapter = decodeViewerChapter(
          readDelimited(reader, data),
          budget
        )
        break
      case 7:
        requireWireType(wire, WireType.LengthDelimited)
        result.aesKey = utf8.decode(readDelimited(reader, data))
        break
      case 8:
        requireWireType(wire, WireType.LengthDelimited)
        result.aesIv = utf8.decode(readDelimited(reader, data))
        break
      case 9:
        requireWireType(wire, WireType.Varint)
        result.maxImageQuality = reader.int32()
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

function decodeResponse(
  data: Uint8Array,
  budget: DecodeBudget
): MangaMillionResponse {
  const reader = startMessage(data, budget)
  const result: MangaMillionResponse = { status: 0 }
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag()
    switch (field) {
      case 1:
        requireWireType(wire, WireType.Varint)
        result.status = reader.int32()
        break
      case 2:
        requireWireType(wire, WireType.LengthDelimited)
        result.errorMessage = utf8.decode(readDelimited(reader, data))
        break
      case 50:
        requireWireType(wire, WireType.LengthDelimited)
        result.titleDetail = decodeTitleDetail(
          readDelimited(reader, data),
          budget
        )
        break
      case 60:
        requireWireType(wire, WireType.LengthDelimited)
        result.chapterList = decodeChapterList(
          readDelimited(reader, data),
          budget
        )
        break
      case 70:
        requireWireType(wire, WireType.LengthDelimited)
        result.viewer = decodeViewer(readDelimited(reader, data), budget)
        break
      case 170:
        requireWireType(wire, WireType.LengthDelimited)
        result.deviceTokenRegister = decodeDeviceTokenRegister(
          readDelimited(reader, data),
          budget
        )
        break
      default:
        skipUnknown(reader, data, wire, field)
    }
  }
  return result
}

export function decodeMangaMillionResponse(
  buffer: ArrayBuffer | Uint8Array
): MangaMillionResponse {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new ProviderContractError(
      "MangaMillion Protobuf response byte limit exceeded"
    )
  try {
    return decodeResponse(bytes, { nodes: 0, chapters: 0, groups: 0, pages: 0 })
  } catch (error) {
    if (error instanceof ProviderContractError) throw error
    throw new ProviderContractError(
      "Invalid MangaMillion Protobuf response",
      error
    )
  }
}
