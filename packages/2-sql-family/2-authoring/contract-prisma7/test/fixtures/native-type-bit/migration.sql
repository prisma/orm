-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeType" (
    "id" INTEGER NOT NULL,
    "value" BIT(8) NOT NULL,
    "single" BIT NOT NULL,

    CONSTRAINT "NativeType_pkey" PRIMARY KEY ("id")
);
