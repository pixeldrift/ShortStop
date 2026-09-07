-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "waypoints" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
