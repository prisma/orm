-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fullName" TEXT GENERATED ALWAYS AS ("firstName" || ' ' || "lastName") STORED,
    "formattedPhone" TEXT GENERATED ALWAYS AS ("countryCode" || ' ' || "phone") STORED,
    "emailDomain" TEXT GENERATED ALWAYS AS (SUBSTR("email", INSTR("email", '@') + 1)) STORED
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "basePrice" DECIMAL NOT NULL,
    "taxRate" DECIMAL NOT NULL DEFAULT 0.0825,
    "totalPrice" DECIMAL GENERATED ALWAYS AS ("basePrice" * (1 + "taxRate")) STORED
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
