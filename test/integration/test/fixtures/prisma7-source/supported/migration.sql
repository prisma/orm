-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'ADMIN');

-- CreateEnum
CREATE TYPE "audit"."AuditAction" AS ENUM ('CREATE', 'DELETE');

-- CreateTable
CREATE TABLE "Scalars" (
    "id" SERIAL NOT NULL,
    "string" TEXT NOT NULL,
    "stringOpt" TEXT,
    "stringList" TEXT[],
    "boolean" BOOLEAN NOT NULL,
    "booleanOpt" BOOLEAN,
    "booleanList" BOOLEAN[],
    "int" INTEGER NOT NULL,
    "intOpt" INTEGER,
    "intList" INTEGER[],
    "bigInt" BIGINT NOT NULL,
    "bigIntOpt" BIGINT,
    "bigIntList" BIGINT[],
    "float" DOUBLE PRECISION NOT NULL,
    "floatOpt" DOUBLE PRECISION,
    "floatList" DOUBLE PRECISION[],
    "decimal" DECIMAL(65,30) NOT NULL,
    "decimalOpt" DECIMAL(65,30),
    "decimalList" DECIMAL(65,30)[],
    "dateTime" TIMESTAMP(3) NOT NULL,
    "dateTimeOpt" TIMESTAMP(3),
    "dateTimeList" TIMESTAMP(3)[],
    "json" JSONB NOT NULL,
    "jsonOpt" JSONB,
    "jsonList" JSONB[],
    "bytes" BYTEA NOT NULL,
    "bytesOpt" BYTEA,
    "bytesList" BYTEA[],
    "role" "user_role" NOT NULL,
    "roleOpt" "user_role",
    "roleList" "user_role"[],

    CONSTRAINT "Scalars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeTypes" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "varChar" VARCHAR(255) NOT NULL,
    "char" CHAR(10) NOT NULL,
    "charNoLength" CHAR NOT NULL,
    "uuid" UUID NOT NULL,
    "inet" INET NOT NULL,
    "boolean" BOOLEAN NOT NULL,
    "integer" INTEGER NOT NULL,
    "smallInt" SMALLINT NOT NULL,
    "bigInt" BIGINT NOT NULL,
    "real" REAL NOT NULL,
    "doublePrecision" DOUBLE PRECISION NOT NULL,
    "decimal" DECIMAL(10,2) NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "timestamptz" TIMESTAMPTZ(6) NOT NULL,
    "date" DATE NOT NULL,
    "time" TIME(6) NOT NULL,
    "timetz" TIMETZ(6) NOT NULL,
    "json" JSON NOT NULL,
    "jsonB" JSONB NOT NULL,
    "byteA" BYTEA NOT NULL,
    "varCharList" VARCHAR(32)[],
    "timestamptzOpt" TIMESTAMPTZ(3),

    CONSTRAINT "NativeTypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timestamps" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAtOpt" TIMESTAMP(3),
    "updatedAtNow" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtTz" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Timestamps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defaults" (
    "id" SERIAL NOT NULL,
    "bigSequence" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uuid4" TEXT NOT NULL,
    "uuid7" TEXT NOT NULL,
    "cuid1" TEXT NOT NULL,
    "cuid2" TEXT NOT NULL,
    "ulid" TEXT NOT NULL,
    "nanoid" TEXT NOT NULL,
    "nanoidSized" TEXT NOT NULL,
    "uuidOpt" TEXT,
    "stringLiteral" TEXT NOT NULL DEFAULT 'hello',
    "intLiteral" INTEGER NOT NULL DEFAULT 42,
    "bigIntLiteral" BIGINT NOT NULL DEFAULT 9007199254740993,
    "floatLiteral" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "decimalLiteral" DECIMAL(65,30) NOT NULL DEFAULT 12.34,
    "booleanLiteral" BOOLEAN NOT NULL DEFAULT true,
    "dateTimeLiteral" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00 +00:00',
    "jsonLiteral" JSONB NOT NULL DEFAULT '{"a":1}',
    "bytesLiteral" BYTEA NOT NULL DEFAULT '\x68656c6c6f',
    "stringList" TEXT[] DEFAULT ARRAY['a', 'b']::TEXT[],
    "intList" INTEGER[] DEFAULT ARRAY[1, 2]::INTEGER[],
    "enumMember" "user_role" NOT NULL DEFAULT 'user',
    "enumList" "user_role"[] DEFAULT ARRAY['ADMIN']::"user_role"[],

    CONSTRAINT "Defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "legacy" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "hashed" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "editorId" INTEGER,
    "legacyOwnerId" INTEGER,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "bio" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" SERIAL NOT NULL,
    "theme" TEXT NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."Composite" (
    "a" INTEGER NOT NULL,
    "b" TEXT NOT NULL,

    CONSTRAINT "Composite_pkey" PRIMARY KEY ("a","b")
);

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" SERIAL NOT NULL,
    "action" "audit"."AuditAction" NOT NULL DEFAULT 'CREATE',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapped_indexes" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "other" TEXT NOT NULL,

    CONSTRAINT "mapped_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyThing" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "LegacyThing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberDefaults" (
    "id" SERIAL NOT NULL,
    "negativeInt" INTEGER NOT NULL DEFAULT -1,
    "negativeSmallInt" SMALLINT NOT NULL DEFAULT -2,
    "negativeFloat" DOUBLE PRECISION NOT NULL DEFAULT -1.5,
    "negativeDecimal" DECIMAL(65,30) NOT NULL DEFAULT -12.34,
    "longDecimal" DECIMAL(65,30) NOT NULL DEFAULT 12345678901234567890.123456789,
    "tinyDecimal" DECIMAL(65,30) NOT NULL DEFAULT 0.000000000000000001,
    "zerosBare" DECIMAL NOT NULL DEFAULT 1.50,
    "zerosScaled" DECIMAL(10,2) NOT NULL DEFAULT 1.50,
    "zerosDefault" DECIMAL(65,30) NOT NULL DEFAULT 1.50,
    "negativeBigInt" BIGINT NOT NULL DEFAULT -9007199254740993,

    CONSTRAINT "NumberDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListDefaults" (
    "id" SERIAL NOT NULL,
    "ints" INTEGER[] DEFAULT ARRAY[-1, 2]::INTEGER[],
    "bigInts" BIGINT[] DEFAULT ARRAY[9007199254740993, -1]::BIGINT[],
    "floats" DOUBLE PRECISION[] DEFAULT ARRAY[-1.5, 2.25]::DOUBLE PRECISION[],
    "decimals" DECIMAL(65,30)[] DEFAULT ARRAY[1.50, -2, 0.000000000000000001]::DECIMAL(65,30)[],
    "dateTimes" TIMESTAMP(3)[] DEFAULT ARRAY['2024-01-01 00:00:00 +00:00', '2024-01-02 03:04:05.123 +02:00']::TIMESTAMP(3)[],
    "bytes" BYTEA[] DEFAULT ARRAY['\x68656c6c6f', '\x776f726c64']::BYTEA[],
    "emptyVarChar" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],

    CONSTRAINT "ListDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalDefaults" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL DEFAULT '2024-01-02 03:04:05 +00:00',
    "time" TIME(3) NOT NULL DEFAULT '1970-01-01 12:34:56.789 +00:00',
    "timetz" TIMETZ(6) NOT NULL DEFAULT '2024-01-02 03:04:05 +02:00',
    "timestamptz" TIMESTAMPTZ(6) NOT NULL DEFAULT '2024-01-02 03:04:05 +02:00',
    "beforeYearOne" TIMESTAMPTZ(3) NOT NULL DEFAULT '0001-01-01 00:30:00 +01:00',

    CONSTRAINT "TemporalDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."CompositeChild" (
    "id" SERIAL NOT NULL,
    "compositeA" INTEGER,
    "compositeB" TEXT NOT NULL,

    CONSTRAINT "CompositeChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."Label" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_Follows" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_Follows_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PostToTag" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_PostToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_Favorites" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_Favorites_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "audit"."_LabelToPost" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_LabelToPost_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");

-- CreateIndex
CREATE INDEX "Post_category_idx" ON "Post"("category");

-- CreateIndex
CREATE INDEX "post_title_category" ON "Post"("title", "category");

-- CreateIndex
CREATE INDEX "Post_hashed_idx" ON "Post" USING HASH ("hashed");

-- CreateIndex
CREATE UNIQUE INDEX "Post_title_category_key" ON "Post"("title", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");

-- CreateIndex
CREATE INDEX "mapped_indexes_first_name_idx" ON "mapped_indexes"("first_name");

-- CreateIndex
CREATE UNIQUE INDEX "mapped_indexes_first_name_other_key" ON "mapped_indexes"("first_name", "other");

-- CreateIndex
CREATE INDEX "_Follows_B_index" ON "_Follows"("B");

-- CreateIndex
CREATE INDEX "_PostToTag_B_index" ON "_PostToTag"("B");

-- CreateIndex
CREATE INDEX "_Favorites_B_index" ON "_Favorites"("B");

-- CreateIndex
CREATE INDEX "_LabelToPost_B_index" ON "audit"."_LabelToPost"("B");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_legacyOwnerId_fkey" FOREIGN KEY ("legacyOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."CompositeChild" ADD CONSTRAINT "CompositeChild_compositeA_compositeB_fkey" FOREIGN KEY ("compositeA", "compositeB") REFERENCES "audit"."Composite"("a", "b") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Follows" ADD CONSTRAINT "_Follows_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Follows" ADD CONSTRAINT "_Follows_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostToTag" ADD CONSTRAINT "_PostToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostToTag" ADD CONSTRAINT "_PostToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Favorites" ADD CONSTRAINT "_Favorites_A_fkey" FOREIGN KEY ("A") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_Favorites" ADD CONSTRAINT "_Favorites_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."_LabelToPost" ADD CONSTRAINT "_LabelToPost_A_fkey" FOREIGN KEY ("A") REFERENCES "audit"."Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."_LabelToPost" ADD CONSTRAINT "_LabelToPost_B_fkey" FOREIGN KEY ("B") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
