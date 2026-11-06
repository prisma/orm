-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "search" tsvector,
    "area" circle NOT NULL DEFAULT '<(0,0),1>'::circle,
    "net" cidr NOT NULL,
    "tags" text[],
    "labels" text[],
    "loc" point NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Host" (
    "id" INTEGER NOT NULL,
    "address" inet NOT NULL,
    "gateway" inet,
    "net" cidr NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Network" (
    "id" INTEGER NOT NULL,
    "prefix" cidr NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_net_key" ON "Post"("net");

-- CreateIndex
CREATE INDEX "Post_search_idx" ON "Post" USING GIN ("search");

-- CreateIndex
CREATE INDEX "Host_gateway_idx" ON "Host"("gateway");

-- CreateIndex
CREATE UNIQUE INDEX "Host_address_gateway_key" ON "Host"("address", "gateway");

-- CreateIndex
CREATE UNIQUE INDEX "Network_prefix_key" ON "Network"("prefix");

-- AddForeignKey
ALTER TABLE "Host" ADD CONSTRAINT "Host_net_fkey" FOREIGN KEY ("net") REFERENCES "Network"("prefix") ON DELETE RESTRICT ON UPDATE CASCADE;
