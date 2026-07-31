import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const OWNER = "cms62cfan0000ih04giwg7ee3";
const rows = await p.stockListing.findMany({
  where: { userId: OWNER },
  select: { id: true, name: true, saleStatus: true, attributes: true },
});
const wall = rows.filter((r) => {
  try {
    const a = JSON.parse(r.attributes || "{}");
    return a.source === "wallapop" || a.wallapopId;
  } catch {
    return false;
  }
});
const statuses = {};
for (const r of rows) statuses[r.saleStatus] = (statuses[r.saleStatus] || 0) + 1;
console.log({
  total: rows.length,
  wallapop: wall.length,
  statuses,
  nonWallapop: rows.length - wall.length,
});
await p.$disconnect();
