import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartButton } from '../../../src/components/add-to-cart-button';
import { Badge } from '../../../src/components/ui/badge';
import { Card, CardContent, CardHeader } from '../../../src/components/ui/card';
import { findProductById } from '../../../src/data/products';
import { getDb } from '../../../src/db';

export const dynamic = 'force-dynamic';

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const product = await findProductById(db, id);

  if (!product) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/"
        className="text-sm text-muted hover:text-foreground mb-4 inline-block no-underline"
      >
        ← Back to catalog
      </Link>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted">{product.brand}</p>
          <h1 className="text-2xl font-bold">{product.name}</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted">{product.description}</p>
          <div className="flex gap-2">
            <Badge variant="muted">{product.primaryCategory}</Badge>
            <Badge variant="outline">{product.subCategory}</Badge>
            <Badge variant="outline">{product.articleType}</Badge>
          </div>
          <div className="text-2xl font-bold text-accent">
            ${product.price.amount.toFixed(2)} {product.price.currency}
          </div>
          <AddToCartButton
            product={{
              id: product.id,
              name: product.name,
              brand: product.brand,
              price: {
                amount: product.price.amount,
                currency: product.price.currency,
              },
              image: { url: product.image.url },
            }}
          />
          <p className="text-xs text-muted">Code: {product.code}</p>
        </CardContent>
      </Card>
    </div>
  );
}
