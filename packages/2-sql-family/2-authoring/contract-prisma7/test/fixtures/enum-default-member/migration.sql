-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'user',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
