-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Timestamps" (
    "id" INTEGER NOT NULL,
    "updatedAtOpt" TIMESTAMP(3),

    CONSTRAINT "Timestamps_pkey" PRIMARY KEY ("id")
);
