import type { FieldInputTypes } from '../prisma/contract.d';
import type { Db } from '../prisma/db';

type ProductInput = FieldInputTypes['__unbound__']['Product'];

export type NewProduct = Pick<ProductInput, 'name' | 'price' | 'rating' | 'thumbnail' | 'details'>;

/** A new product. `sold` and `inStock` take their defaults, 0 and true. */
export function createProduct(db: Db, product: NewProduct) {
  return db.orm.Product.create({
    name: product.name,
    price: product.price,
    rating: product.rating,
    thumbnail: product.thumbnail,
    details: product.details,
  });
}

/** Sets how many of the product have sold and whether any are left, and returns the updated row. */
export function updateStock(db: Db, id: number, sold: number, inStock: boolean) {
  return db.orm.Product.where({ id }).update({ sold, inStock });
}

/** The products in stock at exactly this price, cheapest rating first. */
export function getProductsInStockAt(db: Db, price: string) {
  return db.orm.Product.select('name', 'price', 'rating', 'sold', 'inStock', 'thumbnail', 'details')
    .where({ inStock: true, price })
    .orderBy((p) => p.rating.asc())
    .all();
}
