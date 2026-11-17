-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Timestamps" (
    "id" INTEGER NOT NULL,
    "updatedAtNow" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Timestamps_pkey" PRIMARY KEY ("id")
);
