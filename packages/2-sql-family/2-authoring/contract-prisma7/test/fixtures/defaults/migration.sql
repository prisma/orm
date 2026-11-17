-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'ADMIN');

-- CreateTable
CREATE TABLE "Defaults" (
    "id" SERIAL NOT NULL,
    "bigSequence" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAtTz" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stringLiteral" TEXT NOT NULL DEFAULT 'hello',
    "intLiteral" INTEGER NOT NULL DEFAULT 42,
    "bigIntLiteral" BIGINT NOT NULL DEFAULT 9007199254740993,
    "floatLiteral" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "decimalLiteral" DECIMAL(65,30) NOT NULL DEFAULT 12.34,
    "booleanLiteral" BOOLEAN NOT NULL DEFAULT true,
    "dateTimeLiteral" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00 +00:00',
    "jsonLiteral" JSONB NOT NULL DEFAULT '{"a":1}',
    "bytesLiteral" BYTEA NOT NULL DEFAULT '\x68656c6c6f',
    "stringList" TEXT[] DEFAULT ARRAY['a', 'b']::TEXT[],
    "intList" INTEGER[] DEFAULT ARRAY[1, 2]::INTEGER[],
    "enumMember" "user_role" NOT NULL DEFAULT 'user',
    "enumList" "user_role"[] DEFAULT ARRAY['ADMIN']::"user_role"[],

    CONSTRAINT "Defaults_pkey" PRIMARY KEY ("id")
);
