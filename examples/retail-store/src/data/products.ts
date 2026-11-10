import { MongoFieldFilter, MongoOrExpr } from '@prisma/orm-mongo/query-ast/execution';
import { MongoParamRef } from '@prisma/orm-mongo/value';
import type { FieldOutputTypes } from '../contract';
import type { Db } from '../db';

type Product = FieldOutputTypes['__unbound__']['Product'];

type StoredProduct = Omit<Product, 'id'> & { readonly _id: Product['id'] };

function productOf({ _id, ...product }: StoredProduct): Product {
  return { ...product, id: _id };
}

export function findProducts(db: Db) {
  return db.orm.products.all();
}

export async function findProductsPaginated(
  db: Db,
  skip: number,
  take: number,
): Promise<Product[]> {
  const plan = db.query.from('products').sort({ _id: 1 }).skip(skip).limit(take).build();
  return (await (await db.runtime()).query(plan)).map(productOf);
}

export function findProductById(db: Db, id: string) {
  return db.orm.products.where({ id }).first();
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchProducts(db: Db, query: string): Promise<Product[]> {
  const regex = new MongoParamRef(new RegExp(escapeRegex(query), 'i'));
  const filter = MongoOrExpr.of([
    MongoFieldFilter.of('name', '$regex', regex),
    MongoFieldFilter.of('brand', '$regex', regex),
    MongoFieldFilter.of('articleType', '$regex', regex),
  ]);
  const plan = db.query.from('products').match(filter).build();
  return (await (await db.runtime()).query(plan)).map(productOf);
}

export async function getRandomProducts(db: Db, count: number): Promise<Product[]> {
  const plan = db.query.from('products').sample(count).build();
  return (await (await db.runtime()).query(plan)).map(productOf);
}

/**
 * Vector similarity search via $vectorSearch aggregation stage.
 * Requires an Atlas cluster with a vector search index on the
 * `products.embedding` field. Not available with mongodb-memory-server.
 */
export async function findSimilarProducts(
  db: Db,
  embedding: number[],
  limit: number,
): Promise<Product[]> {
  const plan = db.query
    .from('products')
    .vectorSearch({
      index: 'product_embedding_index',
      path: 'embedding',
      queryVector: embedding,
      numCandidates: limit * 10,
      limit,
    })
    .build();
  return (await (await db.runtime()).query(plan)).map(productOf);
}
