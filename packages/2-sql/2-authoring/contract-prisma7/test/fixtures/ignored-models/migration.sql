-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "legacy";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "archiveId" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy"."archives" (
    "id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy"."ArchiveEntry" (
    "id" INTEGER NOT NULL,
    "archiveId" INTEGER NOT NULL,

    CONSTRAINT "ArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loose" (
    "value" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "archives_label_idx" ON "legacy"."archives"("label");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "legacy"."archives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy"."ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "legacy"."archives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
