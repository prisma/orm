-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "T" (
    "id" INTEGER NOT NULL,
    "a" TEXT NOT NULL,

    CONSTRAINT "T_pkey" PRIMARY KEY ("id")
);
