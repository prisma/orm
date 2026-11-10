-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeType" (
    "id" INTEGER NOT NULL,
    "value" MONEY NOT NULL,
    "list" MONEY[],

    CONSTRAINT "NativeType_pkey" PRIMARY KEY ("id")
);
