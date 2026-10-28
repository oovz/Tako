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
function fields(
  data: Uint8Array,
  budget: Budget,
  visit: (field: Field) => boolean
): void {
  if (++budget.nodes > 20_000) fail()
  const reader = new BinaryReader(data)
  while (reader.pos < reader.len) {
    const [number, wire] = reader.tag()
    if (
      number <= 0 ||
      wire === WireType.StartGroup ||
      wire === WireType.EndGroup
    )
      fail()
    const field = { number, wire, reader, data }
    if (visit(field)) continue
    if (wire === WireType.LengthDelimited) child(field)
    else reader.skip(wire, number)
    if (reader.pos > reader.len) fail()
  }
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
  fields(data, budget, (f) => {
    if (f.number === 1) value.titleId = uint(f)
    else if (f.number === 2) value.id = uint(f)
    else if (f.number === 3) value.name = string(f)
    else if (f.number === 4) value.subtitle = string(f)
    else if (f.number === 6) value.start = uint(f)
    else if (f.number === 7) value.end = uint(f)
    else if (f.number === 16) value.type = uint(f)
    else return false
    return true
  })
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
function detail(data: Uint8Array, budget: Budget): MangaPlusTitleDetail {
  const value: MangaPlusTitleDetail = { description: "", chapters: [] }
  const old: MangaPlusChapter[] = []
  const v2: MangaPlusChapter[] = []
  fields(data, budget, (f) => {
    if (f.number === 1) value.title = title(child(f), budget)
    else if (f.number === 3) value.description = string(f)
    else if (f.number === 9 || f.number === 10)
      old.push(chapter(child(f), budget))
    else if (f.number === 28)
      fields(child(f), budget, (group) => {
        if (group.number < 2 || group.number > 4) return false
        old.push(chapter(child(group), budget))
        return true
      })
    else if (f.number === 38) v2.push(chapter(child(f), budget))
    else if (f.number === 47)
      fields(child(f), budget, (entry) => {
        if (entry.number === 1)
          value.chapters.push(chapter(child(entry), budget))
        else if (entry.number === 2)
          fields(child(entry), budget, (middle) => {
            if (middle.number !== 1) return false
            value.chapters.push({
              ...chapter(child(middle), budget),
              locked: true,
            })
            return true
          })
        else return false
        return true
      })
    else return false
    return true
  })
  if (value.chapters.length === 0) value.chapters = v2.length ? v2 : old
  if (!value.title || value.chapters.length === 0) fail()
  return value
}
function image(data: Uint8Array, budget: Budget): MangaPlusImage {
  if (++budget.images > MAX_CHAPTER_IMAGES) fail()
  const value: MangaPlusImage = {
    url: "",
    width: 0,
    height: 0,
    encryptionKey: "",
  }
  fields(data, budget, (f) => {
    if (f.number === 1) value.url = string(f)
    else if (f.number === 2) value.width = uint(f)
    else if (f.number === 3) value.height = uint(f)
    else if (f.number === 5) value.encryptionKey = string(f)
    else return false
    return true
  })
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
function viewer(data: Uint8Array, budget: Budget): MangaPlusViewer {
  const value: MangaPlusViewer = { chapterId: 0, images: [], viewerToken: "" }
  fields(data, budget, (f) => {
    if (f.number === 2) value.chapterId = uint(f)
    else if (f.number === 19) {
      value.viewerToken = string(f)
      if (value.viewerToken.length > 8192) fail()
    } else if (f.number === 1) {
      let recognized = false
      fields(child(f), budget, (page) => {
        if (page.number === 1) {
          value.images.push(image(child(page), budget))
          recognized = true
          return true
        }
        if ([2, 3, 4, 5].includes(page.number)) recognized = true
        return false
      })
      if (!recognized) fail()
    } else return false
    return true
  })
  if (!value.chapterId || !value.images.length || !value.viewerToken) fail()
  return value
}
function response<T>(
  data: Uint8Array,
  fieldNumber: number,
  decode: (data: Uint8Array, budget: Budget) => T
): T {
  try {
    if (!data.byteLength || data.byteLength > 15_000_000) fail()
    const budget = { nodes: 0, chapters: 0, images: 0 }
    let result: T | undefined
    let errorAction: number | undefined
    fields(data, budget, (field) => {
      if (field.number === 1)
        fields(child(field), budget, (success) => {
          if (success.number !== fieldNumber) return false
          result = decode(child(success), budget)
          return true
        })
      else if (field.number === 2) {
        errorAction = 0
        fields(child(field), budget, (error) => {
          if (error.number !== 1) return false
          errorAction = uint(error)
          return true
        })
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
