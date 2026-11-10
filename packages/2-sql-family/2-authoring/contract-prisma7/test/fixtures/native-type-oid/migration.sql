-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeType" (
    "id" INTEGER NOT NULL,
    "value" OID NOT NULL,
    "list" OID[],

    CONSTRAINT "NativeType_pkey" PRIMARY KEY ("id")
);
