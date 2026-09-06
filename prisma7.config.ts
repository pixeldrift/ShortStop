// Config for the `prisma` CLI (migrate/generate/studio/seed) - Prisma 7
// moved the datasource connection string out of schema.prisma and into
// this file (see prisma/schema.prisma's own doc comment on that). Only
// the CLI reads this; the app itself connects via the driver adapter
// in src/lib/db.ts, which reads DATABASE_URL the normal Next.js way
// (.env.local, auto-loaded).
//
// The CLI runs outside Next.js, so it doesn't get that same automatic
// .env.local loading - loaded here explicitly instead, matching how
// scripts/geocodeRoute.ts already loads .env.local for the same reason.
import { config } from "dotenv";
config({ path: ".env.local" });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Migrations prefer the direct, non-pooled connection when the host
  // provides one (e.g. Neon's own DATABASE_URL_UNPOOLED, set alongside
  // DATABASE_URL by its Vercel integration) - schema changes need
  // session-level advisory locks that a transaction-mode connection
  // pooler (pgbouncer, which Neon's own pooled DATABASE_URL routes
  // through) doesn't reliably support. The app itself still connects
  // over the pooled DATABASE_URL at runtime (src/lib/db.ts) - only
  // this CLI config prefers the unpooled one.
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  },
});
