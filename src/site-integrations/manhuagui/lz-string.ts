const KEY_STR_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const baseReverseDictionary: Record<string, Record<string, number>> = {};

function getBaseValue(alphabet: string, character: string): number {
  if (!baseReverseDictionary[alphabet]) {
    baseReverseDictionary[alphabet] = {};
    for (let index = 0; index < alphabet.length; index += 1) {
      baseReverseDictionary[alphabet][alphabet.charAt(index)] = index;
    }
  }

  return baseReverseDictionary[alphabet][character] ?? 0;
}

function decompress(
  length: number,
  resetValue: number,
  getNextValue: (index: number) => number,
): string | null {
  const dictionary: string[] = [];
  const result: string[] = [];

  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  const data = {
    value: getNextValue(0),
    position: resetValue,
    index: 1,
  };

  const readBits = (bitCount: number): number => {
    let bits = 0;
    const maxpower = 2 ** bitCount;
    let power = 1;

    while (power !== maxpower) {
      const resb = data.value & data.position;
      data.position >>= 1;

      if (data.position === 0) {
        data.position = resetValue;
        data.value = getNextValue(data.index++);
      }

      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    return bits;
  };

  for (let iteration = 0; iteration < 3; iteration += 1) {
    dictionary[iteration] = String(iteration);
  }

  const next = readBits(2);
  let c: string;
  switch (next) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    case 2:
      return '';
    default:
      return null;
  }

  dictionary[3] = c;
  let w = c;
  result.push(c);

  while (true) {
    if (data.index > length) {
      return '';
    }

    const bits = readBits(numBits);
    let current = bits;

    if (current === 0) {
      dictionary[dictSize++] = String.fromCharCode(readBits(8));
      current = dictSize - 1;
      enlargeIn -= 1;
    } else if (current === 1) {
      dictionary[dictSize++] = String.fromCharCode(readBits(16));
      current = dictSize - 1;
      enlargeIn -= 1;
    } else if (current === 2) {
      return result.join('');
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }

    if (dictionary[current]) {
      entry = dictionary[current]!;
    } else if (current === dictSize) {
      entry = w + w.charAt(0);
    } else {
      return null;
    }

    result.push(entry);

    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn -= 1;
    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }
  }
}

export function decompressFromBase64(input: string): string | null {
  if (input == null) {
    return '';
  }

  if (input === '') {
    return null;
  }

  return decompress(input.length, 32, (index) => getBaseValue(KEY_STR_BASE64, input.charAt(index)));
}
