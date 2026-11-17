-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Author" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "author_primary" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "userId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "membership_pair" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbcde" (
    "id" INTEGER NOT NULL,
    "authorIdentifierWithAVeryLongColumnName" INTEGER NOT NULL,

    CONSTRAINT "ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnotherModelNameLongEnoughThatPrismaSevenCutsItsKeyNamesXyz" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "AnotherModelNameLongEnoughThatPrismaSevenCutsItsKeyNamesXy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_cüt" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_c_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "post_written_by" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbcde" ADD CONSTRAINT "ThisModelNameIsLongEnoughThatPrismaSevenCutsItsKeyNamesAbc_fkey" FOREIGN KEY ("authorIdentifierWithAVeryLongColumnName") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
