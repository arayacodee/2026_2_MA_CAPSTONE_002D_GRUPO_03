CREATE TABLE "MailNotification" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lockToken" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "previewedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailNotification_eventKey_key" ON "MailNotification"("eventKey");
CREATE INDEX "MailNotification_acceptedAt_nextAttemptAt_idx" ON "MailNotification"("acceptedAt", "nextAttemptAt");
