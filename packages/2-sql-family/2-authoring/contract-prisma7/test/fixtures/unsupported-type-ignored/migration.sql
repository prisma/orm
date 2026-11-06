-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "search" tsvector,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);
