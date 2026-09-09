/** Location / search normalisation for Opportunity filters. */

export function normalizePlaceToken(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizePlaceDisplay(value: string | null | undefined): string {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function parseStringArrayJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function stringifyStringArray(values: string[] | undefined): string {
  const cleaned = (values || [])
    .map((v) => normalizePlaceDisplay(v))
    .filter(Boolean)
    .slice(0, 20);
  return JSON.stringify(cleaned);
}

export function encodeCursor(payload: {
  postedAt: string;
  id: string;
  score?: number;
}): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): {
  postedAt: string;
  id: string;
  score?: number;
} | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as {
      postedAt?: unknown;
      id?: unknown;
      score?: unknown;
    };
    if (typeof parsed.postedAt !== "string" || typeof parsed.id !== "string") {
      return null;
    }
    return {
      postedAt: parsed.postedAt,
      id: parsed.id,
      score: typeof parsed.score === "number" ? parsed.score : undefined,
    };
  } catch {
    return null;
  }
}
