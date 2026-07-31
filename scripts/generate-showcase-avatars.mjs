import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "public", "showcase", "avatars");
mkdirSync(dir, { recursive: true });

const people = [
  { f: "lucia-in-mexico.svg", bg: "#1e3a4c", a: "#e8b86d", s: "#c48a6a" },
  { f: "valentina-cartagena.svg", bg: "#2c2140", a: "#f0a0a8", s: "#b87a5c" },
  { f: "omar-dahab.svg", bg: "#1a3344", a: "#7ec8e3", s: "#a67c52" },
  { f: "nadia-redsea.svg", bg: "#14303a", a: "#5ec4b8", s: "#c9a07a" },
  { f: "mateo-oaxaca.svg", bg: "#2a2418", a: "#d4a017", s: "#9c6b4a" },
  { f: "siriporn-chiangmai.svg", bg: "#1f2e28", a: "#9fd4a3", s: "#d2a88a" },
];

for (const p of people) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Showcase avatar">
  <rect width="512" height="512" fill="${p.bg}"/>
  <circle cx="256" cy="200" r="96" fill="${p.s}"/>
  <ellipse cx="256" cy="430" rx="150" ry="120" fill="${p.a}"/>
  <circle cx="220" cy="190" r="10" fill="${p.bg}" opacity="0.55"/>
  <circle cx="292" cy="190" r="10" fill="${p.bg}" opacity="0.55"/>
  <path d="M220 230 Q256 250 292 230" stroke="${p.bg}" stroke-width="6" fill="none" opacity="0.4" stroke-linecap="round"/>
</svg>`;
  writeFileSync(join(dir, p.f), svg);
}

console.log("Wrote", readdirSync(dir).join(", "));
