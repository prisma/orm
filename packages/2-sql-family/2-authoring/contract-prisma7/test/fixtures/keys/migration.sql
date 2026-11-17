-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Composite" (
    "a" INTEGER NOT NULL,
    "b_col" TEXT NOT NULL,

    CONSTRAINT "Composite_pkey" PRIMARY KEY ("a","b_col")
);

-- CreateTable
CREATE TABLE "Single" (
    "pk" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,

    CONSTRAINT "Single_pkey" PRIMARY KEY ("pk")
);

-- CreateIndex
CREATE UNIQUE INDEX "Composite_b_col_a_key" ON "Composite"("b_col", "a");

-- CreateIndex
CREATE UNIQUE INDEX "Single_code_key" ON "Single"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Single_x_y_key" ON "Single"("x", "y");
