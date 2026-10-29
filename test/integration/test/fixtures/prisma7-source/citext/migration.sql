-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Account" (
    "id" INTEGER NOT NULL,
    "email" CITEXT NOT NULL,
    "nickname" CITEXT,
    "region" CITEXT NOT NULL,
    "aliases" CITEXT[],

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "authorEmail" CITEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" INTEGER NOT NULL,
    "authorEmail" CITEXT NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitextDefaults" (
    "id" INTEGER NOT NULL,
    "literal" CITEXT NOT NULL DEFAULT 'usd',
    "expr" CITEXT NOT NULL DEFAULT 'a'::citext,
    "none" CITEXT NOT NULL,
    "list" CITEXT[] DEFAULT ARRAY['a', 'B']::CITEXT[],

    CONSTRAINT "CitextDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE INDEX "Account_region_idx" ON "Account"("region");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorEmail_fkey" FOREIGN KEY ("authorEmail") REFERENCES "Account"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorEmail_fkey" FOREIGN KEY ("authorEmail") REFERENCES "Account"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
