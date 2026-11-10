import Link from 'next/link';
import { Badge } from '../src/components/ui/badge';
import { Button } from '../src/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../src/components/ui/card';
import { findProductsPaginated, searchProducts } from '../src/data/products';
import { getDb } from '../src/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 8;

export default async function ProductCatalog({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params['page']) || 1);
  const query = typeof params['q'] === 'string' ? params['q'] : '';

  const db = await getDb();

  const products = query
    ? await searchProducts(db, query)
    : await findProductsPaginated(db, (page - 1) * PAGE_SIZE, PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Product Catalog</h1>
      </div>

      <form className="mb-6 flex gap-2" action="/" method="GET">
        <input
          name="q"
          type="text"
          defaultValue={query}
          placeholder="Search products..."
          className="flex h-10 w-full max-w-sm rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="default">
          Search
        </Button>
        {query && (
          <Button variant="ghost" asChild>
            <Link href="/">Clear</Link>
          </Button>
        )}
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {products.map((product) => (
          <Link
            key={product.id}
            href={`/products/${product.id}`}
            className="no-underline text-inherit"
          >
            <Card className="h-full hover:shadow-md transition-shadow">
              <CardHeader>
                <p className="text-xs text-muted">{product.brand}</p>
                <CardTitle className="text-base">{product.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  <Badge variant="muted">{product.articleType}</Badge>
                  <Badge variant="outline">{product.subCategory}</Badge>
                </div>
                <p className="text-sm text-muted line-clamp-2">{product.description}</p>
              </CardContent>
              <CardFooter>
                <span className="font-bold text-accent">${product.price.amount.toFixed(2)}</span>
              </CardFooter>
            </Card>
          </Link>
        ))}
      </div>

      {products.length === 0 && (
        <p className="text-muted text-center py-12">
          {query
            ? `No products matching "${query}".`
            : 'No products found. Run the seed script first.'}
        </p>
      )}

      {!query && (
        <div className="flex justify-center gap-2 mt-8">
          {page > 1 && (
            <Button variant="outline" asChild>
              <Link href={`/?page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          <span className="flex items-center px-4 text-sm text-muted">Page {page}</span>
          {products.length === PAGE_SIZE && (
            <Button variant="outline" asChild>
              <Link href={`/?page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
