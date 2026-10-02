import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function makeIconPixels(size) {
  const data = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.36;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const gx = x / Math.max(1, size - 1);
      const gy = y / Math.max(1, size - 1);
      data[i] = Math.round(24 + gx * 45);
      data[i + 1] = Math.round(37 + gy * 90);
      data[i + 2] = Math.round(84 + gx * 155);
      data[i + 3] = 255;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      }
      const stemHalf = Math.max(1, Math.round(size * 0.055));
      const stemTop = Math.round(size * 0.36);
      const stemBottom = Math.round(size * 0.73);
      const dotRadius = Math.max(1, Math.round(size * 0.045));
      const inStem = Math.abs(x - center) <= stemHalf && y >= stemTop && y <= stemBottom;
      const inDot = Math.sqrt((x - center) ** 2 + (y - Math.round(size * 0.26)) ** 2) <= dotRadius;
      if (inStem || inDot) {
        data[i] = 23;
        data[i + 1] = 37;
        data[i + 2] = 84;
      }
    }
  }
  return data;
}

export function encodePng({ width, height, data }) {
  if (data.length !== width * height * 4) throw new Error(`RGBA byte length does not match ${width}x${height}`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    data.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString('ascii'); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length;
    offset += 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('only 8-bit RGBA PNGs are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(width * height * 4);
  let inOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inOffset];
    inOffset += 1;
    const row = raw.subarray(inOffset, inOffset + stride);
    inOffset += stride;
    if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    row.copy(out, y * stride);
  }
  return { width, height, data: out };
}

export function resizeNearest(image, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y / size) * image.height));
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x / size) * image.width));
      image.data.copy(out, (y * size + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return { width: size, height: size, data: out };
}

export function dimensions(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
