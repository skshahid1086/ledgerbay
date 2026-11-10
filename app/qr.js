/**
 * QR Code, byte mode, error correction L, versions 1–6.
 * Enough for a UPI payment link. Drawn as an SVG, no network.
 */
const QR_ECC_L = [
  null,
  { data: 19, ecc: 7, blocks: 1 },
  { data: 34, ecc: 10, blocks: 1 },
  { data: 55, ecc: 15, blocks: 1 },
  { data: 80, ecc: 20, blocks: 1 },
  { data: 108, ecc: 26, blocks: 1 },
  { data: 68, ecc: 18, blocks: 2 }
];

const QR_ALIGN = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34]
};

const QR_FORMAT = [
  "111011111000100",
  "111001011110011",
  "111110110101010",
  "111100010011101",
  "110011000101111",
  "110001100011000",
  "110110001000001",
  "110100101110110"
];

function qrGfMul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1d;
    b >>= 1;
  }
  return p;
}

function qrGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = QR_GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= qrGfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

const QR_GF_EXP = new Array(256);
const QR_GF_LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_GF_EXP[i] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  QR_GF_EXP[255] = QR_GF_EXP[0];
})();

function qrReedSolomon(data, eccLen) {
  const gen = qrGenerator(eccLen);
  const res = data.concat(new Array(eccLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= qrGfMul(gen[j], coef);
    }
  }
  return res.slice(data.length);
}

function qrBits(bytes) {
  const out = [];
  bytes.forEach(b => {
    for (let i = 7; i >= 0; i--) out.push((b >> i) & 1);
  });
  return out;
}

function qrChooseVersion(len) {
  for (let v = 1; v <= 6; v++) {
    const spec = QR_ECC_L[v];
    const capacity = spec.data * spec.blocks;
    const overhead = v < 10 ? 2 : 3;
    if (len + overhead <= capacity) return v;
  }
  return 6;
}

function qrDataCodewords(text, version) {
  const spec = QR_ECC_L[version];
  const total = spec.data * spec.blocks;
  const bytes = Array.from(new TextEncoder().encode(text)).slice(0, total - 2);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach(b => push(b, 8));
  const cap = total * 8;
  const term = Math.min(4, cap - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let n = 0;
    for (let b = 0; b < 8; b++) n = (n << 1) | bits[i + b];
    codewords.push(n);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < total) codewords.push(pads[p++ % 2]);
  return codewords;
}

function qrInterleave(codewords, version) {
  const spec = QR_ECC_L[version];
  const blocks = [];
  for (let i = 0; i < spec.blocks; i++) {
    const data = codewords.slice(i * spec.data, (i + 1) * spec.data);
    blocks.push({ data, ecc: qrReedSolomon(data, spec.ecc) });
  }
  const out = [];
  const maxData = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) blocks.forEach(b => { if (i < b.data.length) out.push(b.data[i]); });
  for (let i = 0; i < spec.ecc; i++) blocks.forEach(b => out.push(b.ecc[i]));
  return out;
}

function qrMatrix(text) {
  const version = qrChooseVersion(Array.from(new TextEncoder().encode(text)).length);
  const size = 21 + (version - 1) * 4;
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) grid[r][c] = v; };

  const finder = (r, c) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const on = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(r + y, c + x, on ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (grid[6][i] == null) grid[6][i] = v;
    if (grid[i][6] == null) grid[i][6] = v;
  }
  const align = QR_ALIGN[version] || [];
  align.forEach(r => align.forEach(c => {
    if (grid[r][c] != null) return;
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const on = Math.max(Math.abs(x), Math.abs(y)) !== 1;
        set(r + y, c + x, on ? 1 : 0);
      }
    }
  }));
  set(size - 8, 8, 1);

  const reserved = grid.map(row => row.map(cell => cell != null));
  const codewords = qrInterleave(qrDataCodewords(text, version), version);
  const bits = qrBits(codewords);
  let bit = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = col - dx;
        if (reserved[row][c]) continue;
        const value = bit < bits.length ? bits[bit++] : 0;
        grid[row][c] = value;
      }
    }
    upward = !upward;
  }

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = grid.map(row => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (reserved[r][c]) continue;
        let flip = false;
        if (mask === 0) flip = (r + c) % 2 === 0;
        else if (mask === 1) flip = r % 2 === 0;
        else if (mask === 2) flip = c % 3 === 0;
        else if (mask === 3) flip = (r + c) % 3 === 0;
        else if (mask === 4) flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        else if (mask === 5) flip = ((r * c) % 2) + ((r * c) % 3) === 0;
        else if (mask === 6) flip = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        else flip = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
        if (flip) masked[r][c] ^= 1;
      }
    }
    const format = QR_FORMAT[mask];
    const paintFormat = (r, c, i) => { masked[r][c] = format[i] === "1" ? 1 : 0; };
    for (let i = 0; i < 15; i++) {
      const bitOn = format[i] === "1" ? 1 : 0;
      if (i < 6) masked[i][8] = bitOn;
      else if (i < 8) masked[i + 1][8] = bitOn;
      else masked[size - 15 + i][8] = bitOn;
      if (i < 8) masked[8][size - 1 - i] = bitOn;
      else if (i < 9) masked[8][15 - i + 1] = bitOn;
      else masked[8][14 - i] = bitOn;
    }
    paintFormat(8, 8, 8);
    const score = qrPenalty(masked);
    if (score < bestScore) {
      bestScore = score;
      best = masked;
    }
  }
  return best;
}

function qrPenalty(m) {
  const n = m.length;
  let score = 0;
  const run = (dark, len) => { if (len >= 5) score += 3 + (len - 5); return dark; };
  for (let r = 0; r < n; r++) {
    let dark = m[r][0], len = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === dark) len++;
      else { run(dark, len); dark = m[r][c]; len = 1; }
    }
    run(dark, len);
  }
  for (let c = 0; c < n; c++) {
    let dark = m[0][c], len = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === dark) len++;
      else { run(dark, len); dark = m[r][c]; len = 1; }
    }
    run(dark, len);
  }
  let darks = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) darks++;
  score += Math.floor(Math.abs(darks / (n * n) - 0.5) * 20) * 10;
  return score;
}

function qrSvg(text, px) {
  if (typeof qrcode !== "function") return "";
  const qr = qrcode(0, "M");
  qr.addData(String(text || "upi://pay"));
  qr.make();
  const size = px || 92;
  const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: false });
  return svg.replace("<svg ", `<svg class="upi-qr" width="${size}" height="${size}" shape-rendering="crispEdges" `);
}
