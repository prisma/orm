-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NativeTypeDefaults" (
    "id" INTEGER NOT NULL,
    "bit" BIT(8) NOT NULL DEFAULT '10101010',
    "varBit" VARBIT(8) NOT NULL DEFAULT '101',
    "xml" XML NOT NULL DEFAULT '<a>b</a>',
    "oid" OID NOT NULL DEFAULT 42,
    "oidMax" OID NOT NULL DEFAULT 4294967295,
    "money" MONEY NOT NULL DEFAULT 12.5,
    "moneyNeg" MONEY NOT NULL DEFAULT -1234.56,
    "moneyInt" MONEY NOT NULL DEFAULT 1000,

    CONSTRAINT "NativeTypeDefaults_pkey" PRIMARY KEY ("id")
);
