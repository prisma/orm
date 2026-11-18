-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Parent" (
    "a" INTEGER NOT NULL,
    "b" INTEGER NOT NULL,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("a","b")
);

-- CreateTable
CREATE TABLE "MixedChild" (
    "id" INTEGER NOT NULL,
    "pa" INTEGER,
    "pb" INTEGER NOT NULL,

    CONSTRAINT "MixedChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionalChild" (
    "id" INTEGER NOT NULL,
    "pa" INTEGER,
    "pb" INTEGER,

    CONSTRAINT "OptionalChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MixedChild" ADD CONSTRAINT "MixedChild_pa_pb_fkey" FOREIGN KEY ("pa", "pb") REFERENCES "Parent"("a", "b") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionalChild" ADD CONSTRAINT "OptionalChild_pa_pb_fkey" FOREIGN KEY ("pa", "pb") REFERENCES "Parent"("a", "b") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
