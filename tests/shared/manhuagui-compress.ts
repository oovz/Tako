/**
 * @file manhuagui-compress.ts
 * @description lz-string compressor used to synthesize Manhuagui
 * `__VIEWSTATE` payloads and packed image data for both unit tests
 * (`tests/unit/integrations/manhuagui-test-setup.ts`) and e2e fixtures
 * (`tests/e2e/fixtures/mock-data/site-integrations/manhuagui`).
 *
 * This is the forward counterpart of
 * `@/src/site-integrations/manhuagui/lz-string.ts`'s `decompressFromBase64`.
 * Keep the two algorithms byte-compatible — the test-shared compressor and
 * the production decompressor must round-trip every input.
 */

function compress(
  uncompressed: string,
  bitsPerChar: number,
  getCharFromInt: (value: number) => string,
): string {
  if (uncompressed == null) {
    return '';
  }

  const contextDictionary: Record<string, number> = {};
  const contextDictionaryToCreate: Record<string, boolean> = {};
  let contextC = '';
  let contextW = '';
  let contextEnlargeIn = 2;
  let contextDictSize = 3;
  let contextNumBits = 2;
  const contextData: string[] = [];
  let contextDataVal = 0;
  let contextDataPosition = 0;

  const writeBit = (value: number) => {
    contextDataVal = (contextDataVal << 1) | value;
    if (contextDataPosition === bitsPerChar - 1) {
      contextDataPosition = 0;
      contextData.push(getCharFromInt(contextDataVal));
      contextDataVal = 0;
    } else {
      contextDataPosition += 1;
    }
  };

  const writeBits = (bitCount: number, value: number) => {
    for (let i = 0; i < bitCount; i += 1) {
      writeBit(value & 1);
      value >>= 1;
    }
  };

  const writeDictionaryEntry = (value: string) => {
    if (value.charCodeAt(0) < 256) {
      writeBits(contextNumBits, 0);
      writeBits(8, value.charCodeAt(0));
    } else {
      writeBits(contextNumBits, 1);
      writeBits(16, value.charCodeAt(0));
    }
    contextEnlargeIn -= 1;
    if (contextEnlargeIn === 0) {
      contextEnlargeIn = 2 ** contextNumBits;
      contextNumBits += 1;
    }
  };

  for (let index = 0; index < uncompressed.length; index += 1) {
    contextC = uncompressed.charAt(index);
    if (!(contextC in contextDictionary)) {
      contextDictionary[contextC] = contextDictSize++;
      contextDictionaryToCreate[contextC] = true;
    }

    const contextWC = contextW + contextC;
    if (contextWC in contextDictionary) {
      contextW = contextWC;
      continue;
    }

    if (contextDictionaryToCreate[contextW]) {
      writeDictionaryEntry(contextW);
      delete contextDictionaryToCreate[contextW];
    } else {
      writeBits(contextNumBits, contextDictionary[contextW]!);
    }

    contextEnlargeIn -= 1;
    if (contextEnlargeIn === 0) {
      contextEnlargeIn = 2 ** contextNumBits;
      contextNumBits += 1;
    }

    contextDictionary[contextWC] = contextDictSize++;
    contextW = contextC;
  }

  if (contextW !== '') {
    if (contextDictionaryToCreate[contextW]) {
      writeDictionaryEntry(contextW);
      delete contextDictionaryToCreate[contextW];
    } else {
      writeBits(contextNumBits, contextDictionary[contextW]!);
    }

    contextEnlargeIn -= 1;
    if (contextEnlargeIn === 0) {
      contextEnlargeIn = 2 ** contextNumBits;
      contextNumBits += 1;
    }
  }

  writeBits(contextNumBits, 2);

  while (true) {
    contextDataVal <<= 1;
    if (contextDataPosition === bitsPerChar - 1) {
      contextData.push(getCharFromInt(contextDataVal));
      break;
    }
    contextDataPosition += 1;
  }

  return contextData.join('');
}

/**
 * Base64-encode an lz-string compression of `value`. Output matches the
 * `decompressFromBase64` input contract in `manhuagui/lz-string.ts` exactly.
 */
export function compressToBase64(value: string): string {
  const keyStrBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const compressed = compress(value, 6, (charCode) => keyStrBase64.charAt(charCode));

  switch (compressed.length % 4) {
    case 0:
      return compressed;
    case 1:
      return `${compressed}===`;
    case 2:
      return `${compressed}==`;
    case 3:
      return `${compressed}=`;
    default:
      return compressed;
  }
}
