-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Generated" (
    "id" INTEGER NOT NULL,
    "uuidOpt" TEXT,

    CONSTRAINT "Generated_pkey" PRIMARY KEY ("id")
);
