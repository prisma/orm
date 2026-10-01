-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "posts" (
    "id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "hashed" TEXT NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "post_code_unique" ON "posts"("code");

-- CreateIndex
CREATE INDEX "posts_category_name_idx" ON "posts"("category_name");

-- CreateIndex
CREATE INDEX "post_title_category" ON "posts"("title", "category_name");

-- CreateIndex
CREATE INDEX "posts_hashed_idx" ON "posts" USING HASH ("hashed");

-- CreateIndex
CREATE INDEX "posts_title_idx" ON "posts"("title");

-- CreateIndex
CREATE UNIQUE INDEX "posts_title_category_name_key" ON "posts"("title", "category_name");

-- CreateIndex
CREATE UNIQUE INDEX "post_slug_title_unique" ON "posts"("slug", "title");
