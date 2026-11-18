-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Generated" (
    "id" INTEGER NOT NULL,
    "uuid4" TEXT NOT NULL,
    "uuid4Again" TEXT NOT NULL,
    "uuid7" TEXT NOT NULL,
    "cuid1" TEXT NOT NULL,
    "cuid2" TEXT NOT NULL,
    "ulid" TEXT NOT NULL,
    "nanoid" TEXT NOT NULL,
    "nanoidSized" TEXT NOT NULL,

    CONSTRAINT "Generated_pkey" PRIMARY KEY ("id")
);
