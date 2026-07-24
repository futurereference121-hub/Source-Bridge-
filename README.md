# Source Bridge

People-powered platform for trusted local access, personal sourcing, and discoveries shared by community members.

> If you're somewhere, or you're going somewhere, you can help someone.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — development server (Turbopack)
- `npm run build` — production build
- `npm start` — serve production build

## Key routes

| Route | Purpose |
|-------|---------|
| `/` | Mission-first homepage |
| `/marketplace` | Available Finds |
| `/marketplace/[slug]` | Listing detail |
| `/members/[slug]` | Member storefront |
| `/sourcing` | Personal sourcing request |
| `/categories` | Category browse |
| `/about` | Philosophy |
| `/contact` | Community contact |

`/shop` redirects to `/marketplace`.

## Notes

Mock data only. Auth, messaging, payments, Bridge Score logic, and verification workflows are placeholders for later phases.
