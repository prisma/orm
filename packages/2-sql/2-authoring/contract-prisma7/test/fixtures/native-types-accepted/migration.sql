-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeTypes" (
    "text" TEXT NOT NULL,
    "varChar" VARCHAR(255) NOT NULL,
    "char" CHAR(10) NOT NULL,
    "uuid" UUID NOT NULL,
    "inet" INET NOT NULL,
    "boolean" BOOLEAN NOT NULL,
    "integer" INTEGER NOT NULL,
    "smallInt" SMALLINT NOT NULL,
    "bigInt" BIGINT NOT NULL,
    "real" REAL NOT NULL,
    "doublePrecision" DOUBLE PRECISION NOT NULL,
    "decimal" DECIMAL(10,2) NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "timestamptz" TIMESTAMPTZ(6) NOT NULL,
    "date" DATE NOT NULL,
    "time" TIME(6) NOT NULL,
    "timetz" TIMETZ(6) NOT NULL,
    "json" JSON NOT NULL,
    "jsonB" JSONB NOT NULL,
    "byteA" BYTEA NOT NULL,
    "varCharList" VARCHAR(32)[],
    "timestamptzOpt" TIMESTAMPTZ(3),

    CONSTRAINT "NativeTypes_pkey" PRIMARY KEY ("integer")
);
