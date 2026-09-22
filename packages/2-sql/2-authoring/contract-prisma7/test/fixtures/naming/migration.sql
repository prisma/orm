-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" INTEGER NOT NULL,
    "first_name" TEXT NOT NULL,
    "Bio" TEXT NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keep" (
    "Id" INTEGER NOT NULL,

    CONSTRAINT "Keep_pkey" PRIMARY KEY ("Id")
);
