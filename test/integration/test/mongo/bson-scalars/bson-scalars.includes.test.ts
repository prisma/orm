import { Binary, type Db, Decimal128, Long, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const authorId = new ObjectId('65f0000000000000000000c1');
const bookId = new ObjectId('65f0000000000000000000d1');

async function seed(mongoDb: Db): Promise<void> {
  await mongoDb.collection('authors').insertOne({
    _id: authorId,
    karma: Long.fromBigInt(9_007_199_254_740_993n),
    balance: Decimal128.fromString('12.50'),
    avatar: new Binary(new Uint8Array([1, 2, 3])),
    role: 'admin',
    address: { zip: Long.fromBigInt(2n ** 60n) },
  });
  await mongoDb.collection('books').insertOne({ _id: bookId, title: 'Dune', authorId });
}

const decodedAuthor = {
  _id: authorId.toHexString(),
  karma: 9_007_199_254_740_993n,
  balance: '12.50',
  avatar: new Uint8Array([1, 2, 3]),
  role: 'admin',
  address: { zip: 2n ** 60n, city: null },
};

const decodedBook = { _id: bookId.toHexString(), title: 'Dune', authorId: authorId.toHexString() };

describe('Mongo documents read through the ORM', () => {
  it(
    'decode value-object fields through their codecs',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await seed(mongoDb);
        await mongoDb.collection('authors').insertOne({
          _id: new ObjectId('65f0000000000000000000c2'),
          karma: Long.fromNumber(0),
          balance: Decimal128.fromString('0'),
          role: 'USER',
        });

        const authors = await db.authors.orderBy({ _id: 1 }).all();

        expect(authors).toStrictEqual([
          decodedAuthor,
          {
            _id: '65f0000000000000000000c2',
            karma: 0n,
            balance: '0',
            avatar: null,
            role: 'USER',
            address: null,
          },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'decode a to-one included document through the related model`s codecs',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await seed(mongoDb);

        const books = await db.books.include('author').all();

        expect(books).toStrictEqual([{ ...decodedBook, author: decodedAuthor }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'decode to-many included documents through the related model`s codecs',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await seed(mongoDb);

        const authors = await db.authors.include('books').all();

        expect(authors).toStrictEqual([{ ...decodedAuthor, books: [decodedBook] }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
