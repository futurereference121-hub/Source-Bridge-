/**
 * Generate Source Bridge PWA icons from the official mark geometry
 * (src/components/brand/SourceBridgeLogo.tsx). Run once; commit PNGs.
 *
 *   node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
const NAVY = "#020B1C";
const WHITE = "#ffffff";

function logoSvg(size, { pad = 0, bg = NAVY, fg = WHITE } = {}) {
  const NODE_RADIUS = 18;
  const OUTER_R = 2.6;
  const CENTER_R = 2.2;
  const nodes = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 2) * -1 + (i * Math.PI) / 3;
    return {
      x: 24 + NODE_RADIUS * Math.cos(angle),
      y: 24 + NODE_RADIUS * Math.sin(angle),
    };
  });
  const inner = size - pad * 2;
  const spokes = nodes
    .map(
      (n) =>
        `<line x1="24" y1="24" x2="${n.x}" y2="${n.y}" stroke="${fg}" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>`,
    )
    .join("");
  const circles = nodes
    .map((n) => `<circle cx="${n.x}" cy="${n.y}" r="${OUTER_R}" fill="${fg}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${pad}, ${pad}) scale(${inner / 48})">
    ${spokes}
    ${circles}
    <circle cx="24" cy="24" r="5.5" fill="${fg}" opacity="0.18"/>
    <circle cx="24" cy="24" r="${CENTER_R}" fill="${fg}"/>
  </g>
</svg>`;
}

async function writePng(name, size, opts) {
  const svg = Buffer.from(logoSvg(size, opts));
  const buf = await sharp(svg).png().toBuffer();
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote ${name} (${size}x${size}, ${buf.length} bytes)`);
}

fs.mkdirSync(outDir, { recursive: true });
await writePng("icon-192.png", 192, { pad: 28 });
await writePng("icon-512.png", 512, { pad: 72 });
await writePng("icon-maskable-512.png", 512, { pad: 96 });
await writePng("apple-touch-icon.png", 180, { pad: 26 });
console.log("PWA icons ready in public/icons/");
