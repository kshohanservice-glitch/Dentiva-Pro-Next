#!/usr/bin/env node
/**
 * Generate build/icon.png (512x512) and build/icon.ico (multi-size: 16, 24, 32,
 * 48, 64, 128, 256) from assets/icon-source.png.
 *
 * Also cleans any opaque corner background / dark halo on assets/icon-source.png
 * by extrapolating the interior gradient color across the corner arc boundary
 * before applying a sub-pixel anti-aliased rounded-rectangle SDF alpha mask at
 * each target resolution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'assets', 'icon-source.png');
const outDir = path.join(root, 'build');
const outPng = path.join(outDir, 'icon.png');
const outIco = path.join(outDir, 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const CORNER_RADIUS_RATIO = 192 / 1254;

/**
 * Extrapolate interior gradient RGB into the 4 rounded corners so downsampling
 * never blends edge pixels against black/dark corner pixels.
 */
function extrapolateCornerRgb(img, radiusRatio = CORNER_RADIUS_RATIO) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const data = img.bitmap.data;
  const r = radiusRatio * Math.min(w, h);
  const safeR = Math.max(1, r - 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x < r ? r : x > w - r ? w - r : null;
      const cy = y < r ? r : y > h - r ? h - r : null;
      if (cx === null || cy === null) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= safeR) continue;
      const scale = safeR / dist;
      const sx = Math.min(w - 1, Math.max(0, Math.round(cx + dx * scale - 0.5)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(cy + dy * scale - 0.5)));
      const srcIdx = (sy * w + sx) * 4;
      const dstIdx = (y * w + x) * 4;
      data[dstIdx] = data[srcIdx];
      data[dstIdx + 1] = data[srcIdx + 1];
      data[dstIdx + 2] = data[srcIdx + 2];
      data[dstIdx + 3] = 255;
    }
  }
  return img;
}

/**
 * Apply an anti-aliased rounded-rectangle signed-distance-field (SDF) alpha mask.
 */
function applyRoundedMask(img, radiusRatio = CORNER_RADIUS_RATIO) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const data = img.bitmap.data;
  const r = radiusRatio * Math.min(w, h);
  const hw = w / 2;
  const hh = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const qx = Math.abs(x + 0.5 - hw) - (hw - r);
      const qy = Math.abs(y + 0.5 - hh) - (hh - r);
      const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inDist = Math.min(Math.max(qx, qy), 0);
      const sdf = outDist + inDist - r;
      const coverage = Math.max(0, Math.min(1, 0.5 - sdf));
      const alpha = Math.round(coverage * 255);
      const idx = (y * w + x) * 4;
      if (alpha === 0) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      } else {
        data[idx + 3] = alpha;
      }
    }
  }
  return img;
}

async function main() {
  if (!fs.existsSync(src)) {
    throw new Error(`Icon source missing at ${src}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const base = await Jimp.read(src);
  const side = Math.min(base.bitmap.width, base.bitmap.height);
  if (base.bitmap.width !== base.bitmap.height) {
    const x = Math.floor((base.bitmap.width - side) / 2);
    const y = Math.floor((base.bitmap.height - side) / 2);
    base.crop({ x, y, w: side, h: side });
  }

  // Extrapolate interior gradient into the 4 corners before any downsampling.
  extrapolateCornerRgb(base, CORNER_RADIUS_RATIO);

  // Save cleaned source icon with proper transparent rounded corners.
  const cleanedSource = applyRoundedMask(base.clone(), CORNER_RADIUS_RATIO);
  await cleanedSource.write(src);

  // 512x512 master PNG for electron-builder / Linux / high-DPI window icon.
  const png512 = applyRoundedMask(base.clone().resize({ w: 512, h: 512 }), CORNER_RADIUS_RATIO);
  await png512.write(outPng);

  const buffers = [];
  for (const sz of SIZES) {
    const resized = applyRoundedMask(base.clone().resize({ w: sz, h: sz }), CORNER_RADIUS_RATIO);
    const buf = await resized.getBuffer('image/png');
    buffers.push(buf);
  }

  const ico = await pngToIco(buffers);
  fs.writeFileSync(outIco, ico);

  console.log(
    `[icons] cleaned ${path.relative(root, src)} and wrote ${path.relative(root, outPng)} (512x512) and ${path.relative(
      root,
      outIco,
    )} (${SIZES.join(',')}px, ${ico.length} bytes)`,
  );
}

main().catch((err) => {
  console.error('[icons] failed:', err);
  process.exit(1);
});
