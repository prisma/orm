-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Timestamps" (
    "id" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAtTz" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Timestamps_pkey" PRIMARY KEY ("id")
);
