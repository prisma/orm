-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."Composite" (
    "a" INTEGER NOT NULL,
    "b" TEXT NOT NULL,

    CONSTRAINT "Composite_pkey" PRIMARY KEY ("a","b")
);

-- CreateTable
CREATE TABLE "Plain" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "Plain_pkey" PRIMARY KEY ("id")
);
