import {
  appendPublusImageMetadata,
  PUBLUS_MODE_COUNT,
  type PublusImageMetadata,
} from "./publus-image"
import { parseTrustedComicNettaiCdnUrl } from "./shared"
import { ProviderContractError } from "../provider-contract-error"
import { MAX_CHAPTER_IMAGES } from "@/src/constants/timeouts"
import {
  parsePublusConfig,
  PublusReconstructionFieldsSchema,
  type PublusConfig,
  type PublusConfigContent,
  type PublusConfigFile,
  type PublusConfigPage,
} from "./contracts/publus"

type PublusDecodeState = [Uint8Array, number, number[], number[], number[]]

const BASE64_LOOKUP = (() => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const value: number[] = []
  const left2: number[] = []
  const left4: number[] = []
  const left6: number[] = []
  const right2: number[] = []
  const right4: number[] = []
  const valid: boolean[] = []

  for (let index = 0; index < chars.length; index += 1) {
    const code = chars.charCodeAt(index)
    value[code] = index
    left2[code] = index << 2
    left4[code] = (index << 4) & 255
    left6[code] = (index << 6) & 255
    right2[code] = index >> 2
    right4[code] = index >> 4
    valid[code] = true
  }

  return { value, left2, left4, left6, right2, right4, valid }
})()

function swap<T>(items: T[], left: number, right: number): void {
  const value = items[left]
  items[left] = items[right]
  items[right] = value
}

function utf8Bytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value))
}

function concatArrays(...arrays: number[][]): number[] {
  return arrays.flat()
}

function keySchedule(key: number[] | string): number[] {
  const state = Array.from({ length: 256 }, (_, index) => index)
  const keyAt =
    typeof key === "string"
      ? (index: number) => key.charCodeAt(index)
      : (index: number) => key[index] ?? 0

  let cursor = 0
  for (let index = 0; index < 256; index += 1) {
    cursor = (cursor + state[index] + keyAt(index % key.length)) % 256
    swap(state, index, cursor)
  }

  return state
}

function rc4Step(
  left: number,
  right: number,
  dataIndex: number,
  key: number[],
  data: Uint8Array
): [number, number] {
  left = (left + 1) % 256
  right = (right + key[left]) % 256
  swap(key, left, right)
  data[dataIndex] = (data[dataIndex] ?? 0) ^ key[(key[left] + key[right]) % 256]
  return [left, right]
}

function rc4Reverse(
  state: PublusDecodeState,
  keyMaterial: number[],
  start: number
): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  let left = 0
  let right = 0
  for (let index = start; index >= 0; index -= 2) {
    ;[left, right] = rc4Step(left, right, index, keyMaterial, data)
  }
  return [data, length, key1, key2, key3]
}

function runRc4(
  state: PublusDecodeState,
  keyMaterial: number[],
  count: number
): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  let left = 0
  let right = 0
  for (let index = 0; index < count; index += 1) {
    ;[left, right] = rc4Step(left, right, index, keyMaterial, data)
  }
  return [data, length, key1, key2, key3]
}

function readBase64Quartet(
  encoded: string,
  offset: number,
  purpose: string
): [number, number, number, number] {
  const codes: [number, number, number, number] = [
    encoded.charCodeAt(offset),
    encoded.charCodeAt(offset + 1),
    encoded.charCodeAt(offset + 2),
    encoded.charCodeAt(offset + 3),
  ]
  if (!codes.every((code) => BASE64_LOOKUP.valid[code])) {
    throw new Error(`Invalid Comic Nettai PUBLUS ${purpose} encoding`)
  }
  return codes
}

function decodeBase64Keys(encoded: string, offset: number): number[][] {
  const keys: number[] = []
  const end = offset + 128
  for (; offset < end; offset += 4) {
    const [first, second, third, fourth] = readBase64Quartet(
      encoded,
      offset,
      "key"
    )
    keys.push(
      BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second],
      BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third],
      BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
    )
  }
  return [keys.slice(0, 32), keys.slice(32, 64), keys.slice(64, 96)]
}

function base64BodyByteLength(
  encoded: string,
  start: number,
  end: number
): number {
  const length = (3 * (end - start)) >> 2
  if (encoded.charCodeAt(end - 2) === 61) return length - 2
  if (encoded.charCodeAt(end - 1) === 61) return length - 1
  return length
}

function decodeBase64Ending(
  encoded: string,
  offset: number,
  data: Uint8Array,
  writeIndex: number
): void {
  const first = encoded.charCodeAt(offset)
  const second = encoded.charCodeAt(offset + 1)
  const third = encoded.charCodeAt(offset + 2)
  const fourth = encoded.charCodeAt(offset + 3)
  if (!BASE64_LOOKUP.valid[first] || !BASE64_LOOKUP.valid[second]) {
    throw new Error("Invalid Comic Nettai PUBLUS data ending")
  }

  data[writeIndex] = BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second]
  if (!BASE64_LOOKUP.valid[third]) {
    if (third !== 61 || fourth !== 61) {
      throw new Error("Invalid Comic Nettai PUBLUS data padding")
    }
    return
  }

  data[writeIndex + 1] =
    BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third]
  if (BASE64_LOOKUP.valid[fourth]) {
    data[writeIndex + 2] =
      BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
  } else if (fourth !== 61) {
    throw new Error("Invalid Comic Nettai PUBLUS data padding")
  }
}

function decodeBase64Body(
  encoded: string,
  start: number,
  end: number
): Uint8Array {
  if (start === end) return new Uint8Array(0)

  const data = new Uint8Array(base64BodyByteLength(encoded, start, end))
  let writeIndex = 0
  for (; start < end - 4; start += 4) {
    const [first, second, third, fourth] = readBase64Quartet(
      encoded,
      start,
      "data"
    )
    data[writeIndex++] =
      BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second]
    data[writeIndex++] =
      BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third]
    data[writeIndex++] =
      BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
  }
  decodeBase64Ending(encoded, start, data, writeIndex)
  return data
}

function decodeBase64Pack(
  encoded: string,
  dataOffset: number,
  dataEndOffset: number
): PublusDecodeState {
  const keyEnd = dataOffset + 128
  const bodyBase64Length = dataEndOffset - keyEnd
  if (bodyBase64Length < 0 || bodyBase64Length % 4 !== 0) {
    throw new Error("Invalid Comic Nettai PUBLUS configuration pack")
  }

  const [key1, key2, key3] = decodeBase64Keys(encoded, dataOffset)
  const data = decodeBase64Body(encoded, keyEnd, dataEndOffset)
  return [data, data.length, key1, key2, key3]
}

function sumAndXor(
  seed: number,
  mask: number,
  key: number[]
): [number, number] {
  for (let index = 0; index < 32; index += 1) {
    seed = (seed + key[index]) & 255
    mask ^= key[index]
  }
  return [seed, mask]
}

function reverseRange(start: number, end: number, values: number[]): void {
  for (let right = end, left = start; right > start; right -= 1, left -= 1) {
    swap(values, right, left)
  }
}

function hasBit(value: number, bit: number): boolean {
  return (value & bit) === bit
}

type PublusShuffleInput = {
  values: number[] | Uint8Array
  valuesLength: number
  keys: number[][]
}

function selectShuffleInput(
  selector: 0 | 1 | 2 | 3,
  [data, length, key1, key2, key3]: PublusDecodeState
): PublusShuffleInput {
  switch (selector) {
    case 3:
      return { values: key1, valuesLength: 32, keys: [key2, key3] }
    case 2:
      return { values: key2, valuesLength: 32, keys: [key1, key3] }
    case 1:
      return { values: key3, valuesLength: 32, keys: [key1, key2] }
    case 0:
      return { values: data, valuesLength: length, keys: [key1, key2, key3] }
  }
}

function shuffleByteBits(value: number, seed: number): number {
  if (!hasBit(seed, 2)) value = ((value & 85) << 1) | ((value >>> 1) & 85)
  if (!hasBit(seed, 4)) value = ((value & 51) << 2) | ((value >>> 2) & 51)
  if (!hasBit(seed, 8)) value = ((value & 15) << 4) | ((value >>> 4) & 15)
  return value
}

function readShuffleChunk(
  values: number[] | Uint8Array,
  offset: number,
  end: number,
  seed: number,
  mask: number
): { scratch: number[]; sum: number; mask: number } {
  const scratch: number[] = []
  let sum = seed
  for (; offset < end; offset += 1) {
    const value = shuffleByteBits(values[offset] ?? 0, seed)
    scratch.push(value)
    sum = (sum + value) & 255
    mask ^= value
  }
  return { scratch, sum, mask }
}

function permuteShuffleChunk(scratch: number[], sum: number): void {
  for (let local = 0; local < scratch.length; local += 1) {
    for (let bit = 1; bit <= 6; bit += 1) {
      const power = Math.pow(2, bit)
      if (!hasBit(local, power - 1)) break
      if (!hasBit(sum, power)) {
        reverseRange(local - Math.pow(2, bit - 1), local, scratch)
      }
    }
  }
}

function writeShuffleChunk(
  values: number[] | Uint8Array,
  offset: number,
  end: number,
  scratch: number[],
  jump: number,
  rotateBits: number
): void {
  const chunkLength = scratch.length
  if (rotateBits === 0) {
    for (let local = chunkLength - jump; offset < end;) {
      if (local === chunkLength) local = 0
      values[offset++] = scratch[local++]!
    }
    return
  }

  const inverseRotateBits = 8 - rotateBits
  for (let local = chunkLength - jump - 1; offset < end;) {
    let value = scratch[local] << inverseRotateBits
    local += 1
    if (local === chunkLength) local = 0
    value |= scratch[local] >>> rotateBits
    values[offset++] = value & 255
  }
}

function shuffleBytes(
  selector: 0 | 1 | 2 | 3,
  state: PublusDecodeState
): PublusDecodeState {
  const { values, valuesLength, keys } = selectShuffleInput(selector, state)
  const [seed, mask] = keys.reduce(
    ([seed, mask], key) => sumAndXor(seed, mask, key),
    [0, 0]
  )

  for (let offset = 0; offset < valuesLength; offset += 32) {
    const end = Math.min(offset + 32, valuesLength)
    const chunk = readShuffleChunk(values, offset, end, seed, mask)
    permuteShuffleChunk(chunk.scratch, chunk.sum)
    const jump = chunk.mask >>> 3
    writeShuffleChunk(
      values,
      offset,
      end,
      chunk.scratch,
      offset + 32 > valuesLength ? jump % chunk.scratch.length : jump & 31,
      mask >>> 5
    )
  }
  return state
}

function swapKeyBytes(
  left: number[] | Uint8Array,
  right: number[] | Uint8Array,
  index: number
): void {
  const selected = left[index]
  left[index] = right[index]
  right[index] = selected
}

function mixKeys(state: PublusDecodeState): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  const values = [key1, key2, key3, data]
  const count = Math.min(32, length)
  for (let index = 0; index < count; index += 1) {
    const code = (data[index] ?? 0) ^ key1[index] ^ key2[index] ^ key3[index]
    swapKeyBytes(values[(code >>> 2) & 3], values[code & 3], index)
    swapKeyBytes(values[(code >>> 6) & 3], values[(code >>> 4) & 3], index)
  }
  return state
}

function xorWithKey(
  state: PublusDecodeState,
  fileNameKey: number[]
): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  const key = keySchedule(concatArrays(key2, fileNameKey, key3))
  for (let index = 0, keyIndex = 0; index < length; keyIndex %= key.length) {
    data[index++] = data[index - 1] ^ key[keyIndex++]
  }
  return [data, length, key1, key2, key3]
}

function rc4TransformBytes(source: number[], keyMaterial: number[]): number[] {
  const key = keySchedule(keyMaterial)
  const output: number[] = []
  let left = 0
  let right = 0

  for (let index = 0; index < source.length; index += 1) {
    left = (left + 1) % 256
    right = (right + key[left]) % 256
    swap(key, left, right)
    output.push(source[index] ^ key[(key[left] + key[right]) % 256])
  }

  return output
}

function rotateKeys(
  state: PublusDecodeState,
  fileNameKey: number[]
): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  const nextKey3 = rc4TransformBytes(
    key3,
    concatArrays(key2, key1, fileNameKey)
  )
  const nextKey2 = rc4TransformBytes(
    key2,
    concatArrays(key1, fileNameKey, nextKey3)
  )
  const nextKey1 = rc4TransformBytes(
    key1,
    concatArrays(fileNameKey, nextKey3, nextKey2)
  )

  return [data, length, nextKey1, nextKey2, nextKey3]
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function decodeUtf8(
  state: PublusDecodeState
): [string, string, string, string, number[], number[], number[]] {
  const [data, length, key1, key2, key3] = state
  return [
    new TextDecoder().decode(data.slice(0, length)),
    bytesToHex(key1),
    bytesToHex(key2),
    bytesToHex(key3),
    key1,
    key2,
    key3,
  ]
}

export function decodePublusConfigurationPack(rawText: string): PublusConfig {
  const parsed: unknown = JSON.parse(rawText)
  const preDecodedConfig = parsePublusConfig(parsed)
  if (preDecodedConfig.configuration) {
    return preDecodedConfig
  }

  const dataNeedle = '"data":"'
  const dataOffset = rawText.indexOf(dataNeedle) + dataNeedle.length
  const dataEndOffset = rawText.indexOf('"', dataOffset)
  if (dataOffset < dataNeedle.length || dataEndOffset - dataOffset < 128) {
    throw new Error("Invalid Comic Nettai PUBLUS configuration pack")
  }

  const fileNameKey = utf8Bytes("configuration_pack.json")
  const decoded = [
    (state: PublusDecodeState) => shuffleBytes(0, state),
    (state: PublusDecodeState) => xorWithKey(state, fileNameKey),
    (state: PublusDecodeState) =>
      rc4Reverse(
        state,
        keySchedule(concatArrays(fileNameKey, key1(state), key2(state))),
        (1 | length(state)) - 2
      ),
    (state: PublusDecodeState) =>
      rc4Reverse(
        state,
        keySchedule(concatArrays(key3(state), fileNameKey, key1(state))),
        (length(state) - 1) & -2
      ),
    mixKeys,
    (state: PublusDecodeState) => rotateKeys(state, fileNameKey),
    (state: PublusDecodeState) => shuffleBytes(1, state),
    (state: PublusDecodeState) => shuffleBytes(2, state),
    (state: PublusDecodeState) => shuffleBytes(3, state),
    (state: PublusDecodeState) =>
      runRc4(
        state,
        keySchedule(concatArrays(key3(state), key2(state), fileNameKey)),
        length(state)
      ),
  ].reduce(
    (state, step) => step(state),
    decodeBase64Pack(rawText, dataOffset, dataEndOffset)
  )

  const [json, key1Hex, key2Hex, key3Hex] = decodeUtf8(decoded)
  const decodedConfig: unknown = JSON.parse(json)
  const config = parsePublusConfig(decodedConfig)
  config.configuration ??= {}
  config.configuration.keys = {
    key1: key1Hex,
    key2: key2Hex,
    key3: key3Hex,
  }

  return config
}

function length(state: PublusDecodeState): number {
  return state[1]
}

function key1(state: PublusDecodeState): number[] {
  return state[2]
}

function key2(state: PublusDecodeState): number[] {
  return state[3]
}

function key3(state: PublusDecodeState): number[] {
  return state[4]
}

function hexToBytes(value: string): number[] {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid Comic Nettai PUBLUS key")
  }

  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 2) {
    bytes.push(Number.parseInt(value.slice(index, index + 2), 16))
  }
  return bytes
}

function xorKeys(...keys: number[][]): number[] {
  const result: number[] = []
  for (const key of keys) {
    for (let index = 0; index < key.length; index += 1) {
      result[index] = (result[index] ?? 0) ^ key[index]
    }
  }
  return result
}

function sumBytes(...keys: number[][]): number {
  let result = 0
  for (const key of keys) {
    for (const byte of key) {
      result += byte
    }
  }
  return result
}

function xorLeadingKeyWords(key: number[]): number {
  let result = 0
  const length = Math.min(key.length & -4, 32)
  for (let index = 0; index < length;) {
    result ^= key[index++] << 24
    result ^= key[index++] << 16
    result ^= key[index++] << 8
    result ^= key[index++]
  }
  return result >>> 0
}

function sumCharCodes(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result += value.charCodeAt(index)
  }
  return result
}

function buildPublusImageMetadata(input: {
  pageId: string
  page: PublusConfigPage
  key1: number[]
  key2: number[]
  key3: number[]
}): PublusImageMetadata | null {
  const { page, pageId, key1, key2, key3 } = input
  const fields = PublusReconstructionFieldsSchema.safeParse(page)
  if (!fields.success) return null

  const pageNumber = String(page.No ?? "")
  const pageSeed =
    47 +
    sumCharCodes(pageId) +
    sumCharCodes(pageNumber) +
    sumBytes(key1, key2, key3)
  let mask = pageSeed & 255
  mask |= mask << 8
  mask |= mask << 16

  return {
    mode: pageSeed % PUBLUS_MODE_COUNT,
    seed1: (mask ^ xorLeadingKeyWords(key1) ^ fields.data.NS) >>> 0,
    seed2: (mask ^ xorLeadingKeyWords(key2) ^ fields.data.PS) >>> 0,
    seed3: (mask ^ xorLeadingKeyWords(key3) ^ fields.data.RS) >>> 0,
    tileWidth: fields.data.BlockWidth,
    tileHeight: fields.data.BlockHeight,
  }
}

const PUBLUS_IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp", "gif"])

function assertPublusContentPath(file: string): void {
  const invalidSegments = new Set(["", ".", ".."])
  if (
    /(?:^[a-z][a-z\d+.-]*:)|[\\?#]/i.test(file) ||
    file.split("/").some((segment) => invalidSegments.has(segment))
  ) {
    throw new ProviderContractError(
      `Comic Nettai PUBLUS content has an invalid content path: ${file}`
    )
  }
}

function encodePublusPageNumber(pageNumber: number | string): string {
  const numeric =
    typeof pageNumber === "number"
      ? pageNumber
      : Number.parseInt(pageNumber, 10)
  if (
    Number.isFinite(numeric) &&
    numeric >= 0 &&
    numeric < 1152921504606847000
  ) {
    const hex = Math.trunc(numeric).toString(16)
    return `${hex.length.toString(16)}${hex}`
  }

  return `0${String(pageNumber)}`
}

function pushByteHex(output: number[], value: number): void {
  const high = value >>> 4
  const low = value & 15
  output.push((high < 10 ? 48 : 87) + high)
  output.push((low < 10 ? 48 : 87) + low)
}

function buildPublusImageHash(input: {
  imgName: string
  no: number | string
  key: number[]
}): string {
  const imageName = `${input.imgName}/`
  const pageNumber = String(input.no)
  const seedText = imageName + pageNumber
  const seedLength = seedText.length
  const pageNumberBytes = pageNumber.length << 1
  const imageNameBytes = (1 + imageName.length) << 1
  const totalBytes = (1 + seedLength) << 1
  const buffer = new Array<number>(totalBytes)
  let bufferIndex = 0

  buffer[bufferIndex++] = 0
  buffer[bufferIndex++] = 59
  for (let index = 0; index < seedLength; index += 1) {
    const char = seedText.charCodeAt(index)
    buffer[bufferIndex++] = char >>> 8
    buffer[bufferIndex++] = char & 255
  }

  let warmingLength = pageNumberBytes + totalBytes + totalBytes
  let rounds = 3
  while (warmingLength < 256) {
    warmingLength += totalBytes
    rounds += 1
  }

  let dataSeed = 1670739
  let offsetSeed = 1282576
  let hashSeed = 2237221
  let keyIndex = 0

  for (let round = 0; round < rounds; round += 1) {
    let cursor = round === 0 ? imageNameBytes : 0

    while (cursor < totalBytes) {
      const mixed = (hashSeed ^= buffer[cursor++] ^ input.key[keyIndex++])
      const hashProduct = 435 * hashSeed
      const offsetProduct =
        435 * offsetSeed + ((mixed & 7) << 18) + (hashProduct >>> 22)
      const dataProduct =
        435 * dataSeed +
        ((offsetSeed & 3) << 19) +
        ((4194296 & mixed) >>> 3) +
        (offsetProduct >>> 21)
      hashSeed = hashProduct & 4194303
      offsetSeed = offsetProduct & 2097151
      dataSeed = dataProduct & 2097151
      if (keyIndex >= input.key.length) {
        keyIndex = 0
      }
    }
  }

  const output: number[] = []
  pushByteHex(output, (dataSeed >>> 13) ^ input.key[0])
  pushByteHex(output, ((dataSeed >>> 5) & 255) ^ input.key[1])
  pushByteHex(
    output,
    (((dataSeed & 31) << 3) | (offsetSeed >>> 18)) ^ input.key[2]
  )
  pushByteHex(output, ((offsetSeed >>> 10) & 255) ^ input.key[3])
  pushByteHex(output, ((offsetSeed >>> 2) & 255) ^ input.key[4])
  pushByteHex(
    output,
    (((offsetSeed & 3) << 6) | (hashSeed >>> 16)) ^ input.key[5]
  )
  pushByteHex(output, ((hashSeed >>> 8) & 255) ^ input.key[6])
  pushByteHex(output, (hashSeed & 255) ^ input.key[7])
  return String.fromCharCode(...output)
}

type PublusImageKeys = {
  key1: number[]
  key2: number[]
  key3: number[]
  key: number[]
}
type PublusImageContent = PublusConfigContent & { file: string; type: string }
type PublusImagePage = PublusConfigPage & { No: number | string }

function readPublusImageKeys(config: PublusConfig): PublusImageKeys {
  const keys = config.configuration?.keys
  if (!keys?.key1 || !keys.key2 || !keys.key3) {
    throw new ProviderContractError(
      "Comic Nettai PUBLUS configuration keys are missing"
    )
  }
  const key1 = hexToBytes(keys.key1)
  const key2 = hexToBytes(keys.key2)
  const key3 = hexToBytes(keys.key3)
  return { key1, key2, key3, key: xorKeys(key1, key2, key3) }
}

function readPublusImageContents(config: PublusConfig): PublusImageContent[] {
  const rawContents = config.configuration?.contents ?? []
  if (rawContents.length > MAX_CHAPTER_IMAGES) {
    throw new ProviderContractError(
      `Comic Nettai PUBLUS chapter exceeds the ${MAX_CHAPTER_IMAGES} image limit.`
    )
  }
  const contents = rawContents.map((item) => {
    if (typeof item.file !== "string" || typeof item.type !== "string") {
      throw new ProviderContractError(
        "Comic Nettai PUBLUS content is missing its file or image type."
      )
    }
    return item as PublusImageContent
  })
  return contents.sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
}

function readPublusImagePage(
  config: PublusConfig,
  file: string
): PublusImagePage {
  const fileConfig = config[file] as PublusConfigFile | undefined
  const page = fileConfig?.FileLinkInfo?.PageLinkInfoList?.[0]?.Page
  const pageNumber = page?.No
  if (
    !page ||
    (typeof pageNumber !== "number" && typeof pageNumber !== "string")
  ) {
    throw new ProviderContractError(
      `Comic Nettai PUBLUS reconstruction metadata is missing for ${file}`
    )
  }
  return page as PublusImagePage
}

function buildPublusContentImageUrl(
  trustedBaseUrl: URL,
  config: PublusConfig,
  keys: PublusImageKeys,
  item: PublusImageContent
): string {
  assertPublusContentPath(item.file)
  const imageType = item.type.toLowerCase()
  if (!PUBLUS_IMAGE_TYPES.has(imageType)) {
    throw new ProviderContractError(
      `Comic Nettai PUBLUS content uses an unsupported image type: ${item.type}`
    )
  }
  const page = readPublusImagePage(config, item.file)
  const hash = `${encodePublusPageNumber(page.No)}${buildPublusImageHash({
    imgName: item.file,
    no: page.No,
    key: keys.key,
  })}`
  const imageUrl = parseTrustedComicNettaiCdnUrl(
    new URL(`${item.file}/${hash}.${imageType}`, trustedBaseUrl).toString(),
    "Comic Nettai PUBLUS image URL"
  ).toString()
  const metadata = buildPublusImageMetadata({
    pageId: item.file,
    page,
    ...keys,
  })
  if (!metadata) {
    throw new ProviderContractError(
      `Comic Nettai PUBLUS reconstruction metadata is invalid for ${item.file}`
    )
  }
  return appendPublusImageMetadata(imageUrl, metadata)
}

export function buildPublusImageUrlsFromConfig(
  contentBaseUrl: string,
  config: PublusConfig
): string[] {
  const trustedBaseUrl = parseTrustedComicNettaiCdnUrl(
    contentBaseUrl,
    "Comic Nettai PUBLUS content base URL"
  )
  const keys = readPublusImageKeys(config)
  return readPublusImageContents(config).map((item) =>
    buildPublusContentImageUrl(trustedBaseUrl, config, keys, item)
  )
}
