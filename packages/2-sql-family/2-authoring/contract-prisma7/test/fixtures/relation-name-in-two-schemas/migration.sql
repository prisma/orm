-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "one";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "two";

-- CreateTable
CREATE TABLE "one"."A" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "A_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one"."B" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "B_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two"."C" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "C_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two"."D" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "D_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one"."_X" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_X_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "two"."_X" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_X_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_X_B_index" ON "one"."_X"("B");

-- CreateIndex
CREATE INDEX "_X_B_index" ON "two"."_X"("B");

-- AddForeignKey
ALTER TABLE "one"."_X" ADD CONSTRAINT "_X_A_fkey" FOREIGN KEY ("A") REFERENCES "one"."A"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one"."_X" ADD CONSTRAINT "_X_B_fkey" FOREIGN KEY ("B") REFERENCES "one"."B"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two"."_X" ADD CONSTRAINT "_X_A_fkey" FOREIGN KEY ("A") REFERENCES "two"."C"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two"."_X" ADD CONSTRAINT "_X_B_fkey" FOREIGN KEY ("B") REFERENCES "two"."D"("id") ON DELETE CASCADE ON UPDATE CASCADE;
