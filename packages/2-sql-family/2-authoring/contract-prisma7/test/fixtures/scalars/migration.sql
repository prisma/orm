-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Scalars" (
    "string" TEXT NOT NULL,
    "stringOpt" TEXT,
    "stringList" TEXT[],
    "boolean" BOOLEAN NOT NULL,
    "booleanOpt" BOOLEAN,
    "booleanList" BOOLEAN[],
    "int" INTEGER NOT NULL,
    "intOpt" INTEGER,
    "intList" INTEGER[],
    "bigInt" BIGINT NOT NULL,
    "bigIntOpt" BIGINT,
    "bigIntList" BIGINT[],
    "float" DOUBLE PRECISION NOT NULL,
    "floatOpt" DOUBLE PRECISION,
    "floatList" DOUBLE PRECISION[],
    "decimal" DECIMAL(65,30) NOT NULL,
    "decimalOpt" DECIMAL(65,30),
    "decimalList" DECIMAL(65,30)[],
    "dateTime" TIMESTAMP(3) NOT NULL,
    "dateTimeOpt" TIMESTAMP(3),
    "dateTimeList" TIMESTAMP(3)[],
    "json" JSONB NOT NULL,
    "jsonOpt" JSONB,
    "jsonList" JSONB[],
    "bytes" BYTEA NOT NULL,
    "bytesOpt" BYTEA,
    "bytesList" BYTEA[],

    CONSTRAINT "Scalars_pkey" PRIMARY KEY ("int")
);
