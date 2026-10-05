/**
 * Resolves @/ imports and extensionless TypeScript for the Sandbox ticket
 * form regression. Replaces the database module with the in-memory double.
 */
import fs from "node:fs";
import { createRequire, register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

if (!process.env.SB_GP_HOOKS_REGISTERED) {
  process.env.SB_GP_HOOKS_REGISTERED = "1";
  register(pathToFileURL(fileURLToPath(import.meta.url)).href, import.meta.url);
}

function existing(abs) {
  const candidates = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    `${abs}.js`,
    `${abs}.mjs`,
    path.join(abs, "index.ts"),
    path.join(abs, "index.tsx"),
    path.join(abs, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return {
      url: pathToFileURL(path.join(root, "scripts", "gp-sandbox-next-server-mock.mjs")).href,
      shortCircuit: true,
    };
  }
  if (specifier === "next/headers") {
    return {
      url: pathToFileURL(path.join(root, "scripts", "gp-sandbox-next-headers-mock.mjs")).href,
      shortCircuit: true,
    };
  }
  if (specifier.startsWith("@/")) {
    const file = existing(path.join(root, "src", specifier.slice(2)));
    if (!file) throw new Error(`Cannot resolve ${specifier}`);
    return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  const parent = context.parentURL || "";
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent.includes("/src/")) {
    const file = existing(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      specifier.startsWith("file:") ||
      specifier.startsWith("node:")
    ) {
      throw err;
    }
    const resolved = require.resolve(specifier);
    return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
}

export async function load(url, context, nextLoad) {
  if (url.includes("/src/lib/db.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const prisma = globalThis.__SB_PRISMA;\n",
    };
  }
  return nextLoad(url, context);
}
