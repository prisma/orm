-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AVeryLongModelNameThatKeepsGoingAndGoingForever" (
    "id" INTEGER NOT NULL,
    "aVeryLongColumnNameThatAlsoKeepsGoingAndGoing" TEXT NOT NULL,
    "anotherVeryLongColumnNameThatIsAlsoQuiteLengthy" TEXT NOT NULL,
    "short" TEXT NOT NULL,

    CONSTRAINT "AVeryLongModelNameThatKeepsGoingAndGoingForever_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt" (
    "id" INTEGER NOT NULL,
    "ünïcödé_cölümn_näme_thät_ïs_älsö_vëry_löng" TEXT NOT NULL,

    CONSTRAINT "Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AVeryLongModelNameThatKeepsGoingAndGoingForeverX" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "AVeryLongModelNameThatKeepsGoingAndGoingForeverX_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnotherVeryLongModelNameThatAlsoKeepsGoingAndGoing" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "AnotherVeryLongModelNameThatAlsoKeepsGoingAndGoing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123" (
    "id" INTEGER NOT NULL,
    "col" TEXT NOT NULL,

    CONSTRAINT "Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryL" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnot_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "AVeryLongModelNameThatKeepsGoingAndGoingForever_anotherVery_key" ON "AVeryLongModelNameThatKeepsGoingAndGoingForever"("anotherVeryLongColumnNameThatIsAlsoQuiteLengthy");

-- CreateIndex
CREATE INDEX "AVeryLongModelNameThatKeepsGoingAndGoingForever_aVeryLongCo_idx" ON "AVeryLongModelNameThatKeepsGoingAndGoingForever"("aVeryLongColumnNameThatAlsoKeepsGoingAndGoing");

-- CreateIndex
CREATE UNIQUE INDEX "AVeryLongModelNameThatKeepsGoingAndGoingForever_short_aVery_key" ON "AVeryLongModelNameThatKeepsGoingAndGoingForever"("short", "aVeryLongColumnNameThatAlsoKeepsGoingAndGoing");

-- CreateIndex
CREATE INDEX "Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt__idx" ON "Örebrö_Ünïcödé_ModelNameWithMultiByteCharactersInIt"("ünïcödé_cölümn_näme_thät_ïs_älsö_vëry_löng");

-- CreateIndex
CREATE INDEX "Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123_c_idx" ON "Exactly63CharactersLongNameAbcdefghijklmnopqrstuvwxyz0123"("col");

-- CreateIndex
CREATE INDEX "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnot_B_index" ON "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryL"("B");

-- AddForeignKey
ALTER TABLE "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryL" ADD CONSTRAINT "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnoth_A_fkey" FOREIGN KEY ("A") REFERENCES "AVeryLongModelNameThatKeepsGoingAndGoingForeverX"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnotherVeryL" ADD CONSTRAINT "_AVeryLongModelNameThatKeepsGoingAndGoingForeverXToAnoth_B_fkey" FOREIGN KEY ("B") REFERENCES "AnotherVeryLongModelNameThatAlsoKeepsGoingAndGoing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
