-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Clock" (
    "id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "time" TIME(6) NOT NULL,
    "zoned" TIMETZ(6) NOT NULL,
    "optional" DATE,
    "defaulted" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optionalDefaulted" TIME(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clock_pkey" PRIMARY KEY ("id")
);
