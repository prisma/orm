import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, getProductsInStockAt, updateStock } from '../src/orm-client/products';
import { createDb, type Db } from '../src/prisma/db';
import { copyProject, prisma } from './cli';
import { createTestDatabase, type TestDatabase } from './database';

const serverUrl = process.env['MYSQL_URL'];

describe.skipIf(serverUrl === undefined)(
  'products with Decimal, Float, BigInt, Boolean, Bytes and Json fields',
  () => {
    let database: TestDatabase;
    let db: Db;

    beforeAll(async () => {
      database = await createTestDatabase(serverUrl ?? '');
      const project = await copyProject();
      try {
        const migrate = await prisma(project.dir, database.url, ['db', 'migrate']);
        expect(migrate.exitCode).toBe(0);
      } finally {
        await project.remove();
      }
      db = createDb(database.url);
    });

    afterAll(async () => {
      await db?.close();
      await database?.drop();
    });

    it('writes each value through its codec and reads it back, the decimal as the column prints it', async () => {
      const lamp = await createProduct(db, {
        name: 'Lamp',
        price: '19.9',
        rating: 4.25,
        thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        details: { colors: ['red', 'blue'], watts: 40 },
      });
      await createProduct(db, {
        name: 'Desk',
        price: '19.90',
        rating: 3.5,
        thumbnail: new Uint8Array([]),
        details: { size: { width: 120, depth: 60 } },
      });
      const chair = await createProduct(db, {
        name: 'Chair',
        price: '19.90',
        rating: 4.5,
        thumbnail: new Uint8Array([0xff]),
        details: [],
      });
      await updateStock(db, chair.id, 1, false);
      await updateStock(db, lamp.id, 9007199254740991, true);

      expect(await getProductsInStockAt(db, '19.9')).toEqual([
        {
          name: 'Desk',
          price: '19.90',
          rating: 3.5,
          sold: 0,
          inStock: true,
          thumbnail: new Uint8Array([]),
          details: { size: { width: 120, depth: 60 } },
        },
        {
          name: 'Lamp',
          price: '19.90',
          rating: 4.25,
          sold: 9007199254740991,
          inStock: true,
          thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          details: { colors: ['red', 'blue'], watts: 40 },
        },
      ]);
    });
  },
);
