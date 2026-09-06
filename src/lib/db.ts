import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter at runtime (schema.prisma
// no longer carries a `url` - see its own doc comment) - this is that
// adapter, built from the same DATABASE_URL Next.js already loads from
// .env.local for every other server-side env var in this app.
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set - copy .env.local.example to .env.local and fill it in, then run `npx prisma migrate dev`.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Reused across hot reloads in dev (a fresh `next dev` module reload
// would otherwise open a new connection pool on every edit) - the same
// globalThis-caching pattern Prisma's own docs recommend for Next.js.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
