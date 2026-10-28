import { deflateSync } from "node:zlib"

function chunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, content, checksum])
}

const images = new Map<string, Buffer>()

/** Synthetic raster controls retain the dimensions declared by the captured reader. */
export function boylovePagePng(width: number, height: number): Buffer {
  const key = `${width}:${height}`
  const cached = images.get(key)
  if (cached) return cached
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const stride = width * 3 + 1
  const pixels = Buffer.alloc(stride * height, 0xee)
  for (let row = 0; row < height; row += 1) pixels[row * stride] = 0
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ])
  images.set(key, png)
  return png
}
