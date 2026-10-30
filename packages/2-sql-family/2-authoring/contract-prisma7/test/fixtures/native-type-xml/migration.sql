-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeType" (
    "id" INTEGER NOT NULL,
    "value" XML NOT NULL,
    "optional" XML,

    CONSTRAINT "NativeType_pkey" PRIMARY KEY ("id")
);
