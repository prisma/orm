-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "topId" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Top" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "Top_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_topId_fkey" FOREIGN KEY ("topId") REFERENCES "Top"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
