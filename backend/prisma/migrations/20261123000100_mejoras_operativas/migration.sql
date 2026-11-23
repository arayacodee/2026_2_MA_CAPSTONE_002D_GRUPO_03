BEGIN;

-- CreateEnum
CREATE TYPE "ProfessionalAccessGrant" AS ENUM ('LEGACY', 'MANUAL', 'DEMO');

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessGrant" "ProfessionalAccessGrant",
ADD COLUMN     "isSuspended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "bookedDurationMin" INTEGER,
ADD COLUMN     "bookedPrice" DECIMAL(10,2),
ADD COLUMN     "bookedServiceName" TEXT;

-- AlterTable
ALTER TABLE "SessionEvidence" ADD COLUMN     "deliveryType" TEXT NOT NULL DEFAULT 'upload';

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationChange" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "previousStart" TIMESTAMP(3) NOT NULL,
    "previousEnd" TIMESTAMP(3) NOT NULL,
    "newStart" TIMESTAMP(3) NOT NULL,
    "newEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleException_businessId_day_key" ON "ScheduleException"("businessId", "day");

-- CreateIndex
CREATE INDEX "ReservationChange_reservationId_createdAt_idx" ON "ReservationChange"("reservationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_createdAt_id_idx" ON "AdminAction"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Business_ownerId_key" ON "Business"("ownerId");

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationChange" ADD CONSTRAINT "ReservationChange_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep existing professionals working and make the exception visible in administration.
UPDATE "User" AS u SET "accessGrant" = 'LEGACY'
WHERE u."role" = 'PROFESSIONAL'
  AND NOT EXISTS (SELECT 1 FROM "ProfessionalSubscription" AS p WHERE p."userId" = u."id");

-- The original booking price was not stored. Preserve a completed session's amount
-- and derive the original duration from its interval without inventing any prices.
UPDATE "Reservation" AS r SET
  "bookedDurationMin" = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (r."endsAt" - r."startsAt")) / 60))::integer,
  "bookedPrice" = (SELECT s."amount" FROM "ClientSession" AS s WHERE s."reservationId" = r."id");

COMMIT;

