-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Indexed" (
    "id" INTEGER NOT NULL,
    "a" INTEGER NOT NULL,
    "b" INTEGER NOT NULL,
    "c_column" INTEGER NOT NULL,

    CONSTRAINT "Indexed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Indexed_c_column_key" ON "Indexed"("c_column");

-- CreateIndex
CREATE INDEX "Indexed_b_idx" ON "Indexed"("b");

-- CreateIndex
CREATE UNIQUE INDEX "Indexed_a_b_key" ON "Indexed"("a", "b");
