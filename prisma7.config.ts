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
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
