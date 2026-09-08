-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "nextRouteId" TEXT;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_nextRouteId_fkey" FOREIGN KEY ("nextRouteId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
