-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeType" (
    "id" INTEGER NOT NULL,
    "value" VARBIT(8) NOT NULL,
    "unbounded" VARBIT NOT NULL,

    CONSTRAINT "NativeType_pkey" PRIMARY KEY ("id")
);
