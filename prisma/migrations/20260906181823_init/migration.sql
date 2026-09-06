-- CreateEnum
CREATE TYPE "SchoolLevelDb" AS ENUM ('elementary', 'middle', 'high');

-- CreateEnum
CREATE TYPE "TripTypeDb" AS ENUM ('pickup', 'dropoff');

-- CreateEnum
CREATE TYPE "RouteStatusDb" AS ENUM ('published', 'draft');

-- CreateTable
CREATE TABLE "schools" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "level" "SchoolLevelDb" NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "status" "RouteStatusDb" NOT NULL,
    "routeNumber" TEXT NOT NULL,
    "busNumber" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolLevel" "SchoolLevelDb" NOT NULL,
    "tripType" "TripTypeDb" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_steps" (
    "id" SERIAL NOT NULL,
    "routeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromAt" TEXT NOT NULL,
    "ontoAt" TEXT NOT NULL,
    "riderCount" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waypoints" (
    "cacheKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "displayName" TEXT,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "message" TEXT,
    "raw" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waypoints_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_name_key" ON "schools"("name");

-- CreateIndex
CREATE UNIQUE INDEX "route_steps_routeId_sequence_key" ON "route_steps"("routeId", "sequence");

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
