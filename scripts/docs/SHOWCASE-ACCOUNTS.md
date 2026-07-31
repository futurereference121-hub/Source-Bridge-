# Showcase demo accounts

Six controlled **isDemo** profiles appear on Explore with a “Showcase profile” badge. They are discoverable and browsable but excluded from real payment flows and verification queues.

## Accounts

| Username | Location | Focus |
|----------|----------|-------|
| `sb_cdmx` | Mexico City, Mexico | Silver jewellery, prints, ceramics |
| `sb_cartagena` | Cartagena, Colombia | Wayuu-style bags, crafts |
| `sb_dahab` | Dahab, Egypt | Bedouin crafts, jewellery, textiles |
| `sb_hurghada` | Hurghada, Egypt | Red Sea crafts |
| `sb_oaxaca` | Oaxaca, Mexico | Black clay pottery, textiles, masks |
| `sb_chiangmai` | Chiang Mai, Thailand | Textiles, local crafts |

Emails: `showcase+{username}@sourcebridge.demo`

## Seed / refresh

Requires `.env.local` with `DATABASE_URL`.

```bash
# Preview changes (default — no writes)
npm run seed:showcase

# Apply upserts
npm run seed:showcase -- --confirm
```

The script is **idempotent**:

- Upserts users by `username`
- Updates listings by stable `showcaseKey` / slug (no duplicate products)
- Replaces network cities, refreshes the active status (24 h TTL), and refreshes the opportunity window

Only users matching `isDemo` + `sb_*` username or `@sourcebridge.demo` email are touched.

## Refreshing statuses

Statuses expire after 24 hours. To repopulate Explore feeds with fresh demo statuses:

```bash
npm run seed:showcase -- --confirm
```

Each confirm run deletes existing statuses for showcase users and creates a new 24-hour status with location-specific copy.

## Optional demo login

Password (all showcase accounts): `Showcase!Demo2026`

Use only for manual QA. `isDemo` still blocks messaging to/from these accounts in production flows.
