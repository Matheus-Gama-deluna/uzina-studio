import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderUzinaIcon(size, options = {}) {
  const { maskable = false, monochrome = false } = options;
  const rgba = Buffer.alloc(size * size * 4);
  const bg = monochrome ? [0, 0, 0, 0] : [22, 21, 19, 255];
  const card = monochrome ? [0, 0, 0, 0] : [36, 34, 31, 255];
  const accent = monochrome ? [255, 255, 255, 255] : [224, 138, 60, 255];
  const fg = [244, 241, 236, 255];

  const pad = maskable ? size * 0.2 : size * 0.12;
  const innerMin = pad;
  const innerMax = size - pad;
  const stroke = Math.max(4, Math.round(size * 0.11));
  const uLeft = size * 0.31;
  const uRight = size * 0.69;
  const uTop = size * 0.27;
  const uBottom = size * 0.72;
  const radius = (uRight - uLeft) / 2;
  const cx = size / 2;
  const cyArc = uBottom - radius;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      let color = bg;

      if (
        !monochrome &&
        !maskable &&
        x >= innerMin * 0.5 &&
        x <= size - innerMin * 0.5 &&
        y >= innerMin * 0.5 &&
        y <= size - innerMin * 0.5
      ) {
        color = card;
      }

      const inLeftBar =
        x >= uLeft && x <= uLeft + stroke && y >= uTop && y <= cyArc;
      const inRightBar =
        x >= uRight - stroke && x <= uRight && y >= uTop && y <= cyArc;

      let inBottomArc = false;
      if (y >= cyArc && y <= uBottom + stroke * 0.15) {
        const dx = x - cx;
        const dy = y - cyArc;
        const dist = Math.hypot(dx, dy);
        inBottomArc = dist <= radius && dist >= radius - stroke;
      }

      if (inLeftBar || inRightBar || inBottomArc) {
        color = accent;
      }

      // Pequeno marcador superior direito simbolizando o pulso da fábrica
      const dotCx = uRight - stroke * 0.5;
      const dotCy = uTop - stroke * 0.85;
      if (
        !monochrome &&
        x >= innerMin * 0.4 &&
        x <= innerMax + innerMin * 0.6 &&
        Math.hypot(x - dotCx, y - dotCy) <= stroke * 0.45
      ) {
        color = fg;
      }

      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }

  return encodePng(size, size, rgba);
}

const outDir = path.resolve(process.cwd(), "apps/web/public/icons");
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, "icon-192.png"), renderUzinaIcon(192));
fs.writeFileSync(path.join(outDir, "icon-512.png"), renderUzinaIcon(512));
fs.writeFileSync(
  path.join(outDir, "icon-maskable-512.png"),
  renderUzinaIcon(512, { maskable: true })
);
fs.writeFileSync(
  path.join(outDir, "apple-touch-icon.png"),
  renderUzinaIcon(180)
);
fs.writeFileSync(
  path.join(outDir, "badge-72.png"),
  renderUzinaIcon(72, { monochrome: true })
);

console.log("PWA icons generated at", outDir);
