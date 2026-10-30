const KEY_STR_BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
const baseReverseDictionary: Record<string, Record<string, number>> = {}
const MAX_COMPRESSED_INPUT_LENGTH = 1024 * 1024
const MAX_DECOMPRESSED_OUTPUT_LENGTH = 4 * 1024 * 1024

function getBaseValue(alphabet: string, character: string): number {
  if (!baseReverseDictionary[alphabet]) {
    baseReverseDictionary[alphabet] = {}
    for (let index = 0; index < alphabet.length; index += 1) {
      baseReverseDictionary[alphabet][alphabet.charAt(index)] = index
    }
  }

  return baseReverseDictionary[alphabet][character] ?? 0
}

class LzBitReader {
  private value: number
  private position: number
  index = 1

  constructor(
    private readonly resetValue: number,
    private readonly getNextValue: (index: number) => number
  ) {
    this.value = getNextValue(0)
    this.position = resetValue
  }

  readBits(bitCount: number): number {
    let bits = 0
    const maxpower = 2 ** bitCount
    let power = 1
    while (power !== maxpower) {
      const resb = this.value & this.position
      this.position >>= 1
      if (this.position === 0) {
        this.position = this.resetValue
        this.value = this.getNextValue(this.index++)
      }
      bits |= (resb > 0 ? 1 : 0) * power
      power <<= 1
    }
    return bits
  }
}

class LzDictionary {
  private readonly entries: string[]
  private enlargeIn = 4
  numBits = 3

  constructor(first: string) {
    this.entries = ["0", "1", "2", first]
  }

  readIndex(reader: LzBitReader): number {
    const index = reader.readBits(this.numBits)
    if (index !== 0 && index !== 1) return index
    const literal = String.fromCharCode(reader.readBits(index === 0 ? 8 : 16))
    this.entries.push(literal)
    this.enlargeIn -= 1
    return this.entries.length - 1
  }

  growCodeWidth(): void {
    if (this.enlargeIn === 0) {
      this.enlargeIn = 2 ** this.numBits
      this.numBits += 1
    }
  }

  resolve(index: number, previous: string): string | null {
    if (this.entries[index]) return this.entries[index]
    return index === this.entries.length ? previous + previous.charAt(0) : null
  }

  append(previous: string, entry: string): void {
    this.entries.push(previous + entry.charAt(0))
    this.enlargeIn -= 1
    this.growCodeWidth()
  }
}

function readInitialLzCharacter(reader: LzBitReader): string | null {
  switch (reader.readBits(2)) {
    case 0:
      return String.fromCharCode(reader.readBits(8))
    case 1:
      return String.fromCharCode(reader.readBits(16))
    case 2:
      return ""
    default:
      return null
  }
}

function decompress(
  length: number,
  resetValue: number,
  getNextValue: (index: number) => number
): string | null {
  const reader = new LzBitReader(resetValue, getNextValue)
  const first = readInitialLzCharacter(reader)
  if (first === null || first === "") return first
  const dictionary = new LzDictionary(first)
  const result = [first]
  let resultLength = first.length
  let previous = first

  while (true) {
    if (reader.index > length) return ""
    const current = dictionary.readIndex(reader)
    if (current === 2) return result.join("")
    dictionary.growCodeWidth()
    const entry = dictionary.resolve(current, previous)
    if (entry === null) return null
    resultLength += entry.length
    if (resultLength > MAX_DECOMPRESSED_OUTPUT_LENGTH) return null
    result.push(entry)
    dictionary.append(previous, entry)
    previous = entry
  }
}

export function decompressFromBase64(input: string): string | null {
  if (input == null) {
    return ""
  }

  if (input === "") {
    return null
  }

  if (input.length > MAX_COMPRESSED_INPUT_LENGTH) {
    return null
  }

  return decompress(input.length, 32, (index) =>
    getBaseValue(KEY_STR_BASE64, input.charAt(index))
  )
}
