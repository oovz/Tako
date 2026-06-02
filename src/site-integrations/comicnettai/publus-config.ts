import {
  appendPublusImageMetadata,
  PUBLUS_MODE_COUNT,
  type PublusImageMetadata,
} from './publus-image'

type PublusConfigContent = {
  file?: string
  index?: number
  type?: string
}

type PublusConfigPage = {
  No?: number | string
  NS?: number
  PS?: number
  RS?: number
  BlockWidth?: number
  BlockHeight?: number
}

type PublusConfigPageEntry = {
  Page?: PublusConfigPage
}

type PublusConfigFile = {
  FileLinkInfo?: {
    PageLinkInfoList?: PublusConfigPageEntry[]
  }
}

type PublusConfigKeys = {
  key1?: string
  key2?: string
  key3?: string
}

export type PublusConfig = Record<string, unknown> & {
  configuration?: {
    'file-name-version'?: string
    contents?: readonly PublusConfigContent[]
    keys?: PublusConfigKeys
  }
}

type PublusDecodeState = [Uint8Array, number, number[], number[], number[]]

const BASE64_LOOKUP = (() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
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
  const keyAt = typeof key === 'string'
    ? (index: number) => key.charCodeAt(index)
    : (index: number) => key[index] ?? 0

  let cursor = 0
  for (let index = 0; index < 256; index += 1) {
    cursor = (cursor + state[index] + keyAt(index % key.length)) % 256
    swap(state, index, cursor)
  }

  return state
}

function rc4Step(left: number, right: number, dataIndex: number, key: number[], data: Uint8Array): [number, number] {
  left = (left + 1) % 256
  right = (right + key[left]) % 256
  swap(key, left, right)
  data[dataIndex] = (data[dataIndex] ?? 0) ^ key[(key[left] + key[right]) % 256]
  return [left, right]
}

function rc4Reverse(state: PublusDecodeState, keyMaterial: number[], start: number): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  let left = 0
  let right = 0
  for (let index = start; index >= 0; index -= 2) {
    ;[left, right] = rc4Step(left, right, index, keyMaterial, data)
  }
  return [data, length, key1, key2, key3]
}

function runRc4(state: PublusDecodeState, keyMaterial: number[], count: number): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  let left = 0
  let right = 0
  for (let index = 0; index < count; index += 1) {
    ;[left, right] = rc4Step(left, right, index, keyMaterial, data)
  }
  return [data, length, key1, key2, key3]
}

function decodeBase64Pack(encoded: string, dataOffset: number, dataEndOffset: number): PublusDecodeState {
  const keyEnd = dataOffset + 128
  const bodyBase64Length = dataEndOffset - keyEnd
  if (bodyBase64Length < 0 || bodyBase64Length % 4 !== 0) {
    throw new Error('Invalid Comic Nettai PUBLUS configuration pack')
  }

  const key1 = new Array<number>(32)
  const key2 = new Array<number>(32)
  const key3 = new Array<number>(32)
  let target = key1
  let targetIndex = 0

  for (let index = dataOffset; index < keyEnd;) {
    const first = encoded.charCodeAt(index++)
    const second = encoded.charCodeAt(index++)
    const third = encoded.charCodeAt(index++)
    const fourth = encoded.charCodeAt(index++)
    if (!BASE64_LOOKUP.valid[first] || !BASE64_LOOKUP.valid[second] || !BASE64_LOOKUP.valid[third] || !BASE64_LOOKUP.valid[fourth]) {
      throw new Error('Invalid Comic Nettai PUBLUS key encoding')
    }

    target[targetIndex++] = BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second]
    if (index === dataOffset + 88) {
      target = key3
      targetIndex = 0
    }
    target[targetIndex++] = BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third]
    if (index === dataOffset + 44) {
      target = key2
      targetIndex = 0
    }
    target[targetIndex++] = BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
  }

  if (bodyBase64Length === 0) {
    return [new Uint8Array(0), 0, key1, key2, key3]
  }

  let byteLength = (3 * bodyBase64Length) >> 2
  if (encoded.charCodeAt(dataEndOffset - 2) === 61) {
    byteLength -= 2
  } else if (encoded.charCodeAt(dataEndOffset - 1) === 61) {
    byteLength -= 1
  }

  const data = new Uint8Array(byteLength)
  let writeIndex = 0
  let readIndex = keyEnd
  while (readIndex < dataEndOffset - 4) {
    const first = encoded.charCodeAt(readIndex++)
    const second = encoded.charCodeAt(readIndex++)
    const third = encoded.charCodeAt(readIndex++)
    const fourth = encoded.charCodeAt(readIndex++)
    if (!BASE64_LOOKUP.valid[first] || !BASE64_LOOKUP.valid[second] || !BASE64_LOOKUP.valid[third] || !BASE64_LOOKUP.valid[fourth]) {
      throw new Error('Invalid Comic Nettai PUBLUS data encoding')
    }

    data[writeIndex++] = BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second]
    data[writeIndex++] = BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third]
    data[writeIndex++] = BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
  }

  const first = encoded.charCodeAt(readIndex++)
  const second = encoded.charCodeAt(readIndex++)
  const third = encoded.charCodeAt(readIndex++)
  const fourth = encoded.charCodeAt(readIndex++)
  if (!BASE64_LOOKUP.valid[first] || !BASE64_LOOKUP.valid[second]) {
    throw new Error('Invalid Comic Nettai PUBLUS data ending')
  }

  data[writeIndex++] = BASE64_LOOKUP.left2[first] | BASE64_LOOKUP.right4[second]
  if (BASE64_LOOKUP.valid[third]) {
    data[writeIndex++] = BASE64_LOOKUP.left4[second] | BASE64_LOOKUP.right2[third]
    if (BASE64_LOOKUP.valid[fourth]) {
      data[writeIndex++] = BASE64_LOOKUP.left6[third] | BASE64_LOOKUP.value[fourth]
    } else if (fourth !== 61) {
      throw new Error('Invalid Comic Nettai PUBLUS data padding')
    }
  } else if (third !== 61 || fourth !== 61) {
    throw new Error('Invalid Comic Nettai PUBLUS data padding')
  }

  return [data, byteLength, key1, key2, key3]
}

function sumAndXor(seed: number, mask: number, key: number[]): [number, number] {
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

function shuffleBytes(selector: 0 | 1 | 2 | 3, state: PublusDecodeState): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  let values: number[] | Uint8Array
  let valuesLength: number
  let firstKey: number[]
  let secondKey: number[]
  let thirdKey: number[] | null

  switch (selector) {
    case 3:
      values = key1
      valuesLength = 32
      firstKey = key2
      secondKey = key3
      thirdKey = null
      break
    case 2:
      values = key2
      valuesLength = 32
      firstKey = key1
      secondKey = key3
      thirdKey = null
      break
    case 1:
      values = key3
      valuesLength = 32
      firstKey = key1
      secondKey = key2
      thirdKey = null
      break
    case 0:
      values = data
      valuesLength = length
      firstKey = key1
      secondKey = key2
      thirdKey = key3
      break
  }

  let [seed, mask] = sumAndXor(0, 0, firstKey)
  ;[seed, mask] = sumAndXor(seed, mask, secondKey)
  if (thirdKey) {
    ;[seed, mask] = sumAndXor(seed, mask, thirdKey)
  }

  const rotateBits = mask >>> 5
  const inverseRotateBits = 8 - rotateBits
  const swapPairs = !hasBit(seed, 2)
  const swapNibbles = !hasBit(seed, 4)
  const swapHalves = !hasBit(seed, 8)
  const scratch: number[] = []

  for (let offset = 0; offset < valuesLength;) {
    const partialBlock = offset + 32 > valuesLength
    const end = Math.min(offset + 32, valuesLength)
    const chunkLength = end - offset
    let chunkSum = seed
    let chunkMask = mask

    for (let local = 0, source = offset; local < chunkLength;) {
      let value = values[source++] ?? 0
      if (swapPairs) value = ((value & 85) << 1) | ((value >>> 1) & 85)
      if (swapNibbles) value = ((value & 51) << 2) | ((value >>> 2) & 51)
      if (swapHalves) value = ((value & 15) << 4) | ((value >>> 4) & 15)
      scratch[local++] = value
      chunkSum = (chunkSum + value) & 255
      chunkMask ^= value
    }

    for (let local = 0; local < chunkLength; local += 1) {
      for (let bit = 1; bit <= 6; bit += 1) {
        const power = Math.pow(2, bit)
        if (!hasBit(local, power - 1)) break
        if (!hasBit(chunkSum, power)) {
          reverseRange(local - Math.pow(2, bit - 1), local, scratch)
        }
      }
    }

    let jump = chunkMask >>> 3
    jump = partialBlock ? jump % chunkLength : jump & 31

    if (rotateBits === 0) {
      for (let target = offset, local = chunkLength - jump; target < end;) {
        if (local === chunkLength) local = 0
        values[target++] = scratch[local++]!
      }
    } else {
      for (let target = offset, local = chunkLength - jump - 1; target < end;) {
        let value = scratch[local] << inverseRotateBits
        local += 1
        if (local === chunkLength) local = 0
        value |= scratch[local] >>> rotateBits
        values[target++] = value & 255
      }
    }

    offset = end
  }

  return [data, length, key1, key2, key3]
}

function mixKeys(state: PublusDecodeState): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  const count = Math.min(32, length)

  for (let index = 0; index < count; index += 1) {
    const code = (data[index] ?? 0) ^ key1[index] ^ key2[index] ^ key3[index]
    let selected: number
    let replaced: number

    switch (code & 12) {
      case 0:
        selected = key1[index]!
        break
      case 4:
        selected = key2[index]!
        break
      case 8:
        selected = key3[index]!
        break
      default:
        selected = data[index]!
        break
    }

    switch (code & 3) {
      case 0:
        replaced = key1[index]!
        key1[index] = selected
        break
      case 1:
        replaced = key2[index]!
        key2[index] = selected
        break
      case 2:
        replaced = key3[index]!
        key3[index] = selected
        break
      default:
        replaced = data[index]!
        data[index] = selected
        break
    }

    switch (code & 12) {
      case 0:
        key1[index] = replaced
        break
      case 4:
        key2[index] = replaced
        break
      case 8:
        key3[index] = replaced
        break
      default:
        data[index] = replaced
        break
    }

    switch (code & 192) {
      case 0:
        selected = key1[index]!
        break
      case 64:
        selected = key2[index]!
        break
      case 128:
        selected = key3[index]!
        break
      default:
        selected = data[index]!
        break
    }

    switch (code & 48) {
      case 0:
        replaced = key1[index]!
        key1[index] = selected
        break
      case 16:
        replaced = key2[index]!
        key2[index] = selected
        break
      case 32:
        replaced = key3[index]!
        key3[index] = selected
        break
      default:
        replaced = data[index]!
        data[index] = selected
        break
    }

    switch (code & 192) {
      case 0:
        key1[index] = replaced
        break
      case 64:
        key2[index] = replaced
        break
      case 128:
        key3[index] = replaced
        break
      default:
        data[index] = replaced
        break
    }
  }

  return [data, length, key1, key2, key3]
}

function xorWithKey(state: PublusDecodeState, fileNameKey: number[]): PublusDecodeState {
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

function rotateKeys(state: PublusDecodeState, fileNameKey: number[]): PublusDecodeState {
  const [data, length, key1, key2, key3] = state
  const nextKey3 = rc4TransformBytes(key3, concatArrays(key2, key1, fileNameKey))
  const nextKey2 = rc4TransformBytes(key2, concatArrays(key1, fileNameKey, nextKey3))
  const nextKey1 = rc4TransformBytes(key1, concatArrays(fileNameKey, nextKey3, nextKey2))

  return [
    data,
    length,
    nextKey1,
    nextKey2,
    nextKey3,
  ]
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeUtf8(state: PublusDecodeState): [string, string, string, string, number[], number[], number[]] {
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
  const parsed = JSON.parse(rawText) as PublusConfig
  if (parsed.configuration) {
    return parsed
  }

  const dataNeedle = '"data":"'
  const dataOffset = rawText.indexOf(dataNeedle) + dataNeedle.length
  const dataEndOffset = rawText.indexOf('"', dataOffset)
  if (dataOffset < dataNeedle.length || dataEndOffset - dataOffset < 128) {
    throw new Error('Invalid Comic Nettai PUBLUS configuration pack')
  }

  const fileNameKey = utf8Bytes('configuration_pack.json')
  const decoded = [
    (state: PublusDecodeState) => shuffleBytes(0, state),
    (state: PublusDecodeState) => xorWithKey(state, fileNameKey),
    (state: PublusDecodeState) => rc4Reverse(state, keySchedule(concatArrays(fileNameKey, key1(state), key2(state))), ((1 | length(state)) - 2)),
    (state: PublusDecodeState) => rc4Reverse(state, keySchedule(concatArrays(key3(state), fileNameKey, key1(state))), ((length(state) - 1) & -2)),
    mixKeys,
    (state: PublusDecodeState) => rotateKeys(state, fileNameKey),
    (state: PublusDecodeState) => shuffleBytes(1, state),
    (state: PublusDecodeState) => shuffleBytes(2, state),
    (state: PublusDecodeState) => shuffleBytes(3, state),
    (state: PublusDecodeState) => runRc4(state, keySchedule(concatArrays(key3(state), key2(state), fileNameKey)), length(state)),
  ].reduce((state, step) => step(state), decodeBase64Pack(rawText, dataOffset, dataEndOffset))

  const [json, key1Hex, key2Hex, key3Hex] = decodeUtf8(decoded)
  const config = JSON.parse(json) as PublusConfig
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
    throw new Error('Invalid Comic Nettai PUBLUS key')
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
    result ^= (key[index++] ?? 0) << 24
    result ^= (key[index++] ?? 0) << 16
    result ^= (key[index++] ?? 0) << 8
    result ^= (key[index++] ?? 0)
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
  if (
    typeof page.NS !== 'number'
    || typeof page.PS !== 'number'
    || typeof page.RS !== 'number'
    || typeof page.BlockWidth !== 'number'
    || typeof page.BlockHeight !== 'number'
    || !Number.isFinite(page.BlockWidth)
    || !Number.isFinite(page.BlockHeight)
    || page.BlockWidth <= 0
    || page.BlockHeight <= 0
  ) {
    return null
  }

  const pageNumber = String(page.No ?? '')
  const pageSeed = 47
    + sumCharCodes(pageId)
    + sumCharCodes(pageNumber)
    + sumBytes(key1, key2, key3)
  let mask = pageSeed & 255
  mask |= mask << 8
  mask |= mask << 16

  return {
    mode: pageSeed % PUBLUS_MODE_COUNT,
    seed1: (mask ^ xorLeadingKeyWords(key1) ^ page.NS) >>> 0,
    seed2: (mask ^ xorLeadingKeyWords(key2) ^ page.PS) >>> 0,
    seed3: (mask ^ xorLeadingKeyWords(key3) ^ page.RS) >>> 0,
    tileWidth: page.BlockWidth,
    tileHeight: page.BlockHeight,
  }
}

function encodePublusPageNumber(pageNumber: number | string): string {
  const numeric = typeof pageNumber === 'number' ? pageNumber : Number.parseInt(pageNumber, 10)
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1152921504606847000) {
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

function buildPublusImageHash(input: { imgName: string; no: number | string; key: number[] }): string {
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
      const offsetProduct = 435 * offsetSeed + ((mixed & 7) << 18) + (hashProduct >>> 22)
      const dataProduct = 435 * dataSeed + ((offsetSeed & 3) << 19) + (((4194296 & mixed) >>> 3)) + (offsetProduct >>> 21)
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
  pushByteHex(output, (((dataSeed & 31) << 3) | (offsetSeed >>> 18)) ^ input.key[2])
  pushByteHex(output, ((offsetSeed >>> 10) & 255) ^ input.key[3])
  pushByteHex(output, ((offsetSeed >>> 2) & 255) ^ input.key[4])
  pushByteHex(output, (((offsetSeed & 3) << 6) | (hashSeed >>> 16)) ^ input.key[5])
  pushByteHex(output, ((hashSeed >>> 8) & 255) ^ input.key[6])
  pushByteHex(output, (hashSeed & 255) ^ input.key[7])
  return String.fromCharCode(...output)
}

export function buildPublusImageUrlsFromConfig(contentBaseUrl: string, config: PublusConfig): string[] {
  const keys = config.configuration?.keys
  if (!keys?.key1 || !keys.key2 || !keys.key3) {
    throw new Error('Comic Nettai PUBLUS configuration keys are missing')
  }

  const key1 = hexToBytes(keys.key1)
  const key2 = hexToBytes(keys.key2)
  const key3 = hexToBytes(keys.key3)
  const key = xorKeys(key1, key2, key3)
  const contents = [...(config.configuration?.contents ?? [])]
    .filter((item): item is PublusConfigContent & { file: string; type: string } => (
      typeof item.file === 'string'
      && typeof item.type === 'string'
    ))
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))

  const urls: string[] = []
  for (const item of contents) {
    const fileConfig = config[item.file] as PublusConfigFile | undefined
    const page = fileConfig?.FileLinkInfo?.PageLinkInfoList?.[0]?.Page
    const pageNumber = page?.No
    if (!page || (typeof pageNumber !== 'number' && typeof pageNumber !== 'string')) {
      continue
    }

    const hash = `${encodePublusPageNumber(pageNumber)}${buildPublusImageHash({
      imgName: item.file,
      no: pageNumber,
      key,
    })}`
    const imageUrl = new URL(`${item.file}/${hash}.${item.type}`, contentBaseUrl).toString()
    const metadata = buildPublusImageMetadata({ pageId: item.file, page, key1, key2, key3 })
    urls.push(metadata ? appendPublusImageMetadata(imageUrl, metadata) : imageUrl)
  }

  return urls
}
