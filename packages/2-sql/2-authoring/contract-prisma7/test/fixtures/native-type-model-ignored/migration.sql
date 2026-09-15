-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateTable
CREATE TABLE "Account" (
    "id" INTEGER NOT NULL,
    "nickname" CITEXT,
    "currency" CITEXT NOT NULL DEFAULT 'usd',
    "balance" MONEY NOT NULL,
    "email" CITEXT NOT NULL,
    "region" CITEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "authorEmail" CITEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE INDEX "Account_region_idx" ON "Account"("region");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorEmail_fkey" FOREIGN KEY ("authorEmail") REFERENCES "Account"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
