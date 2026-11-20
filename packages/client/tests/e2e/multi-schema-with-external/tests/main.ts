import fs from 'node:fs/promises'
import path from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { InvoiceStatus, PrismaClient } from '@prisma/client'

describe('Prisma External Tables and Enums', () => {
  let adapter: PrismaPg
  let prisma: PrismaClient

  beforeAll(() => {
    adapter = new PrismaPg({
      connectionString: process.env['TEST_E2E_POSTGRES_URI']!,
    })
    prisma = new PrismaClient({ adapter })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Clean up data before each test
    await prisma.invoice.deleteMany()
    await prisma.order.deleteMany()
    await prisma.user.deleteMany()
  })

  test('can create and query external invoices with InvoiceStatus enum', async () => {
    // Create user and order first
    await prisma.user.create({
      data: { id: 1 },
    })

    await prisma.order.create({
      data: {
        id: 1,
        userId: 1,
      },
    })

    // Create an invoice in the external table
    const invoice = await prisma.invoice.create({
      data: {
        id: 1,
        orderId: 1,
        amount: 99.99,
      },
    })

    expect(invoice).toEqual({ id: 1, orderId: 1, amount: 99.99 })

    // Query invoices
    const invoices = await prisma.invoice.findMany()
    expect(invoices).toEqual([{ id: 1, orderId: 1, amount: 99.99 }])

    // Verify InvoiceStatus enum values are available
    expect(InvoiceStatus.Paid).toBe('Paid')
    expect(InvoiceStatus.Unpaid).toBe('Unpaid')
  })

  test('can query relations across schemas', async () => {
    // Create user
    await prisma.user.create({
      data: { id: 1 },
    })

    // Create order
    await prisma.order.create({
      data: {
        id: 1,
        userId: 1,
      },
    })

    // Create invoice
    await prisma.invoice.create({
      data: {
        id: 1,
        orderId: 1,
        amount: 149.99,
      },
    })

    // Query user with orders
    const userWithOrders = await prisma.user.findUnique({
      where: { id: 1 },
      include: { orders: true },
    })

    expect(userWithOrders).toEqual({
      id: 1,
      orders: [{ id: 1, userId: 1 }],
    })

    // Query order with user and invoice
    const orderWithRelations = await prisma.order.findUnique({
      where: { id: 1 },
      include: {
        user: true,
        invoice: true,
      },
    })

    expect(orderWithRelations).toEqual({
      id: 1,
      userId: 1,
      user: { id: 1 },
      invoice: { id: 1, orderId: 1, amount: 149.99 },
    })

    // Query invoice with order
    const invoiceWithOrder = await prisma.invoice.findUnique({
      where: { id: 1 },
      include: { order: true },
    })

    expect(invoiceWithOrder).toEqual({
      id: 1,
      orderId: 1,
      amount: 149.99,
      order: { id: 1, userId: 1 },
    })
  })

  test('created correct migration without external table', async () => {
    const migrations = await fs.readdir(path.join(__dirname, '..', 'prisma', 'migrations'))

    expect(migrations.length).toBe(2) // 1 initial migration + 1 migration_lock.toml
    const createRelationshipMigration = await fs.readFile(
      path.join(__dirname, '..', 'prisma', 'migrations', migrations[0], 'migration.sql'),
      'utf-8',
    )
    expect(createRelationshipMigration).not.toContain('CREATE TABLE invoicing."Invoice"')
    expect(createRelationshipMigration).toMatchInlineSnapshot(`
"-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "base";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shop";

-- CreateEnum
CREATE TYPE "shop"."Size" AS ENUM ('Small', 'Medium', 'Large');

-- CreateTable
CREATE TABLE "base"."User" (
    "id" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop"."Order" (
    "id" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "shop"."Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "base"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
"
`)
  })
})

export {}
