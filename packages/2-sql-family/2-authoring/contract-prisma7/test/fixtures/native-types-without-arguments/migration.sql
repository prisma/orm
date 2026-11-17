-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeTypes" (
    "id" INTEGER NOT NULL,
    "char" CHAR NOT NULL,
    "varChar" VARCHAR NOT NULL,
    "decimal" DECIMAL NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    "timestamptz" TIMESTAMPTZ NOT NULL,
    "time" TIME NOT NULL,
    "timetz" TIMETZ NOT NULL,

    CONSTRAINT "NativeTypes_pkey" PRIMARY KEY ("id")
);
