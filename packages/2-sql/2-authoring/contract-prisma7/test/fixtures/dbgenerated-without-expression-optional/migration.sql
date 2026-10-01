-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "T" (
    "id" INTEGER NOT NULL,
    "a" TEXT,
    "list" TEXT[],

    CONSTRAINT "T_pkey" PRIMARY KEY ("id")
);
