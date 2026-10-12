#!/usr/bin/env node
/**
 * Regenerate the launcher/splash artwork from assets/images/icon.png.
 *
 *   cd frontend
 *   node scripts/make-icons.mjs
 *
 * icon.png is the SOURCE and is never written by this script. Everything else
 * is derived from it so the three files can never drift apart:
 *
 *   adaptive-icon.png  1024x1024, transparent. This is what Android 8+ actually
 *                      draws on the launcher. The mark is scaled to fit inside
 *                      Android's safe zone, because the launcher masks this
 *                      layer to a circle on some devices and a squircle on
 *                      others -- anything outside the safe zone gets cut off.
 *   splash-image.png   1024x1024, transparent. Drawn by expo-splash-screen at
 *                      `imageWidth` dp on the background colour.
 *   favicon.png        512x512, full bleed (web only, no mask to worry about).
 *
 * The mark is lifted off its flat background by a flood fill inwards from the
 * image border: a pixel is background only if it is both reachable from the
 * edge and near the corner colour. The droplet's dark interior is enclosed by
 * the cyan outline, so it stays opaque and the logo keeps its shape.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(HERE, "..", "assets", "images");
const SOURCE = path.join(IMAGES, "icon.png");

// How near the corner colour a pixel must be to count as background. The
// measured background spans 3 levels of red and 26 of blue, so this is roomy;
// the droplet interior is deliberately further away than this and, more to the
// point, is not reachable from the border.
const BACKGROUND_TOLERANCE = 30;

// The mark's height as a fraction of the canvas. Android's guaranteed-visible
// area is a 66dp circle on a 108dp canvas, so the mark's own bounding circle
// (this droplet is 1.25x taller than it is wide) has to fit inside it:
// 0.48 x 1024 x 1.247 = 613px = 60% of the canvas, just inside the 61% safe
// circle. Larger than this and a circular launcher mask clips the droplet tip.
const ADAPTIVE_MARK_HEIGHT = 0.48;
const SPLASH_MARK_HEIGHT = 0.8;

const ADAPTIVE_SIZE = 1024;
const SPLASH_SIZE = 1024;
const FAVICON_SIZE = 512;

const distance = (r, g, b, cr, cg, cb) =>
  Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);

/** Flood fill from the border; returns a Uint8Array of 1 = background. */
function backgroundMask(png) {
  const { width: w, height: h, data } = png;
  const mask = new Uint8Array(w * h);

  // Seed colour: the average of the four corners.
  let sr = 0, sg = 0, sb = 0;
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = (w * y + x) << 2;
    sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
  }
  sr /= 4; sg /= 4; sb /= 4;

  const isBackground = (px) => {
    const i = px << 2;
    return distance(data[i], data[i + 1], data[i + 2], sr, sg, sb) <= BACKGROUND_TOLERANCE;
  };

  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const px = w * y + x;
    if (mask[px]) return;
    if (!isBackground(px)) return;
    mask[px] = 1;
    stack.push(px);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const px = stack.pop();
    const x = px % w;
    const y = (px / w) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  return mask;
}

/** The mark on transparency, cropped to its own bounds. */
function extractMark(png) {
  const { width: w, height: h, data } = png;
  const mask = backgroundMask(png);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[w * y + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("flood fill consumed the whole image - is the background flat?");

  const mw = maxX - minX + 1;
  const mh = maxY - minY + 1;
  const out = Buffer.alloc(mw * mh * 4);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const from = ((y + minY) * w + (x + minX)) << 2;
      const to = (y * mw + x) << 2;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = mask[(y + minY) * w + (x + minX)] ? 0 : 255;
    }
  }
  return { width: mw, height: mh, data: out };
}

/**
 * Area-average resample. Averages in premultiplied alpha so the transparent
 * side of an edge cannot darken the opaque side into a grey halo.
 */
function resample(src, dstW, dstH) {
  const { width: sw, height: sh, data } = src;
  const out = Buffer.alloc(dstW * dstH * 4);
  const scaleX = sw / dstW;
  const scaleY = sh / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const y0 = dy * scaleY;
    const y1 = Math.min(sh, y0 + scaleY);
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * scaleX;
      const x1 = Math.min(sw, x0 + scaleX);
      let r = 0, g = 0, b = 0, a = 0, weight = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const area = wx * wy;
          const i = (sy * sw + sx) << 2;
          const alpha = data[i + 3] / 255;
          r += data[i] * alpha * area;
          g += data[i + 1] * alpha * area;
          b += data[i + 2] * alpha * area;
          a += alpha * area;
          weight += area;
        }
      }

      const o = (dy * dstW + dx) << 2;
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / weight) * 255);
    }
  }
  return { width: dstW, height: dstH, data: out };
}

/** The mark centred on a transparent square canvas, at the given height. */
function centred(mark, size, markHeight) {
  const scale = (size * markHeight) / mark.height;
  const scaled = resample(mark, Math.round(mark.width * scale), Math.round(size * markHeight));
  const out = Buffer.alloc(size * size * 4);
  const offsetX = Math.round((size - scaled.width) / 2);
  const offsetY = Math.round((size - scaled.height) / 2);

  for (let y = 0; y < scaled.height; y++) {
    const dy = y + offsetY;
    if (dy < 0 || dy >= size) continue;
    for (let x = 0; x < scaled.width; x++) {
      const dx = x + offsetX;
      if (dx < 0 || dx >= size) continue;
      const from = (y * scaled.width + x) << 2;
      const to = (dy * size + dx) << 2;
      out[to] = scaled.data[from];
      out[to + 1] = scaled.data[from + 1];
      out[to + 2] = scaled.data[from + 2];
      out[to + 3] = scaled.data[from + 3];
    }
  }
  return { width: size, height: size, data: out };
}

function opaqueBounds({ width: w, height: h, data }) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[((y * w + x) << 2) + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function write(name, image) {
  const file = path.join(IMAGES, name);
  fs.writeFileSync(file, PNG.sync.write(image, { colorType: 6 }));
  const b = opaqueBounds(image);
  const pct = (v, total) => `${((v / total) * 100).toFixed(1)}%`;
  console.log(
    `${name.padEnd(18)} ${image.width}x${image.height}  ` +
      `mark ${b.width}x${b.height} (${pct(b.width, image.width)} x ${pct(b.height, image.height)}), ` +
      `centred at ${pct((b.minX + b.maxX) / 2, image.width)} / ${pct((b.minY + b.maxY) / 2, image.height)}`,
  );
}

const source = PNG.sync.read(fs.readFileSync(SOURCE));
console.log(`source             icon.png ${source.width}x${source.height}`);

const mark = extractMark(source);
console.log(`                   mark cut out at ${mark.width}x${mark.height} (aspect ${(mark.width / mark.height).toFixed(3)})`);

write("adaptive-icon.png", centred(mark, ADAPTIVE_SIZE, ADAPTIVE_MARK_HEIGHT));
write("splash-image.png", centred(mark, SPLASH_SIZE, SPLASH_MARK_HEIGHT));
write("favicon.png", resample(source, FAVICON_SIZE, FAVICON_SIZE));
