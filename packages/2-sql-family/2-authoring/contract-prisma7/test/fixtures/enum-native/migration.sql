-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'ADMIN');

-- CreateEnum
CREATE TYPE "audit"."AuditAction" AS ENUM ('CREATE', 'DELETE');

-- CreateEnum
CREATE TYPE "Unused" AS ENUM ('A', 'B');

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "role" "user_role" NOT NULL,
    "roleOpt" "user_role",
    "roleList" "user_role"[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" INTEGER NOT NULL,
    "action" "audit"."AuditAction" NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
