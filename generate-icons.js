const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, drawFn) {
  const buffer = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  // Build raw scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 4 + 1)] = 0; // Filter None
    buffer.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(scanlines);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // Color type (RGBA)
  ihdr[10] = 0; // Compression method
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace method

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation
function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function iconDraw(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.46;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Anti-aliased rounded circle
  if (dist > r) {
    if (dist < r + 1) {
      const alpha = Math.max(0, Math.min(255, Math.floor((r + 1 - dist) * 255)));
      return [16, 185, 129, alpha]; // Emerald primary
    }
    return [0, 0, 0, 0];
  }

  // Inner gradient (emerald #059669 to teal #0d9488)
  const grad = y / h;
  const rCol = Math.floor(5 + (13 - 5) * grad);
  const gCol = Math.floor(150 + (148 - 150) * grad);
  const bCol = Math.floor(105 + (136 - 105) * grad);

  // Draw a stylized attendance checklist & clock mark inside
  const nx = x / w;
  const ny = y / h;

  // White clipboard / card
  if (nx >= 0.26 && nx <= 0.74 && ny >= 0.24 && ny <= 0.76) {
    // Top clip
    if (ny <= 0.32 && nx >= 0.38 && nx <= 0.62) {
      return [30, 41, 59, 255]; // Dark clip
    }
    // Checkmark or lines
    if (ny >= 0.42 && ny <= 0.46 && nx >= 0.35 && nx <= 0.65) {
      return [16, 185, 129, 255]; // green line
    }
    if (ny >= 0.52 && ny <= 0.56 && nx >= 0.35 && nx <= 0.65) {
      return [59, 130, 246, 255]; // blue line
    }
    if (ny >= 0.62 && ny <= 0.66 && nx >= 0.35 && nx <= 0.55) {
      return [99, 102, 241, 255]; // indigo line
    }
    return [255, 255, 255, 255]; // card body
  }

  return [rCol, gCol, bCol, 255];
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach((size) => {
  const png = createPNG(size, size, iconDraw);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${size}x${size})`);
});
