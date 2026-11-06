-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Legacy" (
    "id" INTEGER NOT NULL,
    "code" INT4 NOT NULL,
    "name" varchar(10),

    CONSTRAINT "Legacy_pkey" PRIMARY KEY ("id")
);
