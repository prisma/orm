-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "one";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "two";

-- CreateTable
CREATE TABLE "one"."Post" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two"."Tag" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two"."_PostToTag" (
    "id" INTEGER NOT NULL,
    "extra" TEXT NOT NULL,

    CONSTRAINT "_PostToTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one"."_PostToTag" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_PostToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PostToTag_B_index" ON "one"."_PostToTag"("B");

-- AddForeignKey
ALTER TABLE "one"."_PostToTag" ADD CONSTRAINT "_PostToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "one"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one"."_PostToTag" ADD CONSTRAINT "_PostToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "two"."Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
