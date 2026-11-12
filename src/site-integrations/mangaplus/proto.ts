import { BinaryReader, WireType } from "@bufbuild/protobuf/wire"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import { ProviderContractError } from "../provider-contract-error"
import type {
  MangaPlusChapter,
  MangaPlusImage,
  MangaPlusTitle,
  MangaPlusTitleDetail,
  MangaPlusViewer,
} from "./contracts"

type Budget = { nodes: number; chapters: number; images: number }
type Field = {
  number: number
  wire: WireType
  reader: BinaryReader
  data: Uint8Array
}
const utf8 = new TextDecoder("utf-8", { fatal: true })

function fail(): never {
  throw new ProviderContractError("Invalid MANGA Plus response contract")
}
function uint(field: Field): number {
  if (field.wire !== WireType.Varint) fail()
  const value = BigInt(field.reader.uint64())
  if (value > 0xffff_ffffn) fail()
  return Number(value)
}
function child(field: Field): Uint8Array {
  if (field.wire !== WireType.LengthDelimited) fail()
  const length = BigInt(field.reader.uint64())
  if (length > BigInt(field.reader.len - field.reader.pos)) fail()
  const start = field.reader.pos
  field.reader.pos += Number(length)
  return field.data.subarray(start, field.reader.pos)
}
function string(field: Field): string {
  const value = child(field)
  if (value.byteLength > 128_000) fail()
  return utf8.decode(value)
}
function validateTag(number: number, wire: WireType): void {
  if (number <= 0 || wire === WireType.StartGroup || wire === WireType.EndGroup)
    fail()
}
function fields(
  data: Uint8Array,
  budget: Budget,
  visit: (field: Field) => boolean
): void {
  if (++budget.nodes > 20_000) fail()
  const reader = new BinaryReader(data)
  while (reader.pos < reader.len) {
    const [number, wire] = reader.tag()
    validateTag(number, wire)
    const field = { number, wire, reader, data }
    if (visit(field)) continue
    if (wire === WireType.LengthDelimited) child(field)
    else reader.skip(wire, number)
    if (reader.pos > reader.len) fail()
  }
}
function readChapterField(f: Field, value: MangaPlusChapter): boolean {
  if (f.number === 1) value.titleId = uint(f)
  else if (f.number === 2) value.id = uint(f)
  else if (f.number === 3) value.name = string(f)
  else if (f.number === 4) value.subtitle = string(f)
  else if (f.number === 6) value.start = uint(f)
  else if (f.number === 7) value.end = uint(f)
  else if (f.number === 9) value.verticalOnly = uint(f) !== 0
  else if (f.number === 16) value.type = uint(f)
  else return false
  return true
}
function chapter(data: Uint8Array, budget: Budget): MangaPlusChapter {
  if (++budget.chapters > 10_000) fail()
  const value: MangaPlusChapter = {
    id: 0,
    titleId: 0,
    name: "",
    subtitle: "",
    type: 0,
    start: 0,
    end: 0,
  }
  fields(data, budget, (f) => readChapterField(f, value))
  if (!value.id || !value.titleId || !value.name.trim()) fail()
  return value
}
function title(data: Uint8Array, budget: Budget): MangaPlusTitle {
  const value: MangaPlusTitle = {
    id: 0,
    name: "",
    author: "",
    coverUrl: "",
    language: 0,
  }
  fields(data, budget, (f) => {
    if (f.number === 1) value.id = uint(f)
    else if (f.number === 2) value.name = string(f)
    else if (f.number === 3) value.author = string(f)
    else if (f.number === 4) value.coverUrl = string(f)
    else if (f.number === 7) value.language = uint(f)
    else return false
    return true
  })
  if (!value.id || !value.name.trim()) fail()
  return value
}
function legacyChapterGroup(
  data: Uint8Array,
  budget: Budget,
  chapters: MangaPlusChapter[]
): void {
  fields(data, budget, (group) => {
    if (group.number < 2 || group.number > 4) return false
    chapters.push(chapter(child(group), budget))
    return true
  })
}
function lockedChapterGroup(
  data: Uint8Array,
  budget: Budget,
  chapters: MangaPlusChapter[]
): void {
  fields(data, budget, (middle) => {
    if (middle.number !== 1) return false
    chapters.push({ ...chapter(child(middle), budget), locked: true })
    return true
  })
}
function currentChapterEntry(
  data: Uint8Array,
  budget: Budget,
  chapters: MangaPlusChapter[]
): void {
  fields(data, budget, (entry) => {
    if (entry.number === 1) chapters.push(chapter(child(entry), budget))
    else if (entry.number === 2)
      lockedChapterGroup(child(entry), budget, chapters)
    else return false
    return true
  })
}
function readDetailField(
  f: Field,
  budget: Budget,
  value: MangaPlusTitleDetail,
  old: MangaPlusChapter[],
  v2: MangaPlusChapter[]
): boolean {
  if (f.number === 1) value.title = title(child(f), budget)
  else if (f.number === 3) value.description = string(f)
  else if (f.number === 16) {
    if (f.wire !== WireType.Varint) fail()
    value.rating = f.reader.int32()
  } else if (f.number === 9 || f.number === 10)
    old.push(chapter(child(f), budget))
  else if (f.number === 28) legacyChapterGroup(child(f), budget, old)
  else if (f.number === 38) v2.push(chapter(child(f), budget))
  else if (f.number === 47)
    currentChapterEntry(child(f), budget, value.chapters)
  else return false
  return true
}
function detail(data: Uint8Array, budget: Budget): MangaPlusTitleDetail {
  const value: MangaPlusTitleDetail = {
    description: "",
    rating: 0,
    chapters: [],
  }
  const old: MangaPlusChapter[] = []
  const v2: MangaPlusChapter[] = []
  fields(data, budget, (f) => readDetailField(f, budget, value, old, v2))

  if (value.chapters.length === 0) value.chapters = v2.length ? v2 : old
  if (!value.title || value.chapters.length === 0) fail()
  return value
}
function readImageField(f: Field, value: MangaPlusImage): boolean {
  if (f.number === 1) value.url = string(f)
  else if (f.number === 2) value.width = uint(f)
  else if (f.number === 3) value.height = uint(f)
  else if (f.number === 5) value.encryptionKey = string(f)
  else return false
  return true
}
function image(data: Uint8Array, budget: Budget): MangaPlusImage {
  if (++budget.images > MAX_CHAPTER_IMAGES) fail()
  const value: MangaPlusImage = {
    url: "",
    width: 0,
    height: 0,
    encryptionKey: "",
  }
  fields(data, budget, (f) => readImageField(f, value))
  if (
    !value.url ||
    !value.width ||
    !value.height ||
    (value.encryptionKey &&
      !/^(?:[a-f0-9]{2}){1,128}$/i.test(value.encryptionKey))
  )
    fail()
  return value
}
function viewerPage(
  data: Uint8Array,
  budget: Budget,
  images: MangaPlusImage[]
): void {
  let recognized = false
  fields(data, budget, (page) => {
    if (page.number === 1) {
      images.push(image(child(page), budget))
      recognized = true
      return true
    }
    if ([2, 3, 4, 5].includes(page.number)) recognized = true
    return false
  })
  if (!recognized) fail()
}
function viewer(data: Uint8Array, budget: Budget): MangaPlusViewer {
  const value: MangaPlusViewer = { chapterId: 0, images: [], viewerToken: "" }
  fields(data, budget, (f) => {
    if (f.number === 2) value.chapterId = uint(f)
    else if (f.number === 19) {
      value.viewerToken = string(f)
      if (value.viewerToken.length > 8192) fail()
    } else if (f.number === 1) {
      viewerPage(child(f), budget, value.images)
    } else return false
    return true
  })
  if (!value.chapterId || !value.images.length || !value.viewerToken) fail()
  return value
}
function successResult<T>(
  data: Uint8Array,
  budget: Budget,
  fieldNumber: number,
  decode: (data: Uint8Array, budget: Budget) => T
): T | undefined {
  let result: T | undefined
  fields(data, budget, (success) => {
    if (success.number !== fieldNumber) return false
    result = decode(child(success), budget)
    return true
  })
  return result
}
function errorCode(data: Uint8Array, budget: Budget): number {
  let action = 0
  fields(data, budget, (error) => {
    if (error.number !== 1) return false
    action = uint(error)
    return true
  })
  return action
}
function validateResponseBytes(data: Uint8Array): void {
  if (!data.byteLength || data.byteLength > 15_000_000) fail()
}
function response<T>(
  data: Uint8Array,
  fieldNumber: number,
  decode: (data: Uint8Array, budget: Budget) => T
): T {
  try {
    validateResponseBytes(data)
    const budget = { nodes: 0, chapters: 0, images: 0 }
    let result: T | undefined
    let errorAction: number | undefined
    fields(data, budget, (field) => {
      if (field.number === 1) {
        const decoded = successResult(child(field), budget, fieldNumber, decode)
        if (decoded !== undefined) result = decoded
      } else if (field.number === 2) {
        errorAction = errorCode(child(field), budget)
      } else return false
      return true
    })
    if (errorAction !== undefined)
      throw new ProviderContractError(
        `MANGA Plus rejected the request (code ${errorAction}).`
      )
    if (!result) fail()
    return result
  } catch (error) {
    if (error instanceof ProviderContractError) throw error
    throw new ProviderContractError("MANGA Plus returned invalid binary data")
  }
}
export function decodeMangaPlusTitle(data: Uint8Array): MangaPlusTitleDetail {
  return response(data, 8, detail)
}
export function decodeMangaPlusViewer(data: Uint8Array): MangaPlusViewer {
  return response(data, 10, viewer)
}
