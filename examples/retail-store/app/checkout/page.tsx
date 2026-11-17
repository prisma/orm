import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../src/components/ui/card';
import { Separator } from '../../src/components/ui/separator';
import { getCartByUserId } from '../../src/data/carts';
import { findLocations } from '../../src/data/locations';
import { getDb } from '../../src/db';
import { getAuthUser, getAuthUserId } from '../../src/lib/auth';
import { CheckoutForm } from './checkout-form';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect('/login');

  const db = await getDb();
  const [cart, user, locations] = await Promise.all([
    getCartByUserId(db, userId),
    getAuthUser(),
    findLocations(db),
  ]);

  const items = cart?.items ?? [];
  if (items.length === 0) redirect('/cart');

  const total = items.reduce((sum, item) => sum + item.price.amount * item.amount, 0);

  const userAddress = user?.address
    ? `${user.address.streetAndNumber}, ${user.address.city}, ${user.address.postalCode}, ${user.address.country}`
    : '';

  const locationList = locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    address: `${loc.streetAndNumber}, ${loc.city}`,
  }));

  return (
    <div className="max-w-2xl">
      <Link
        href="/cart"
        className="text-sm text-muted hover:text-foreground mb-4 inline-block no-underline"
      >
        ← Back to cart
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Checkout</CardTitle>
        </CardHeader>
        <CardContent>
          <h2 className="font-semibold mb-3">Order Summary</h2>
          <div className="flex flex-col gap-2 mb-4">
            {items.map((item) => (
              <div key={item.productId} className="flex justify-between text-sm">
                <span>
                  {item.name} ×{item.amount}
                </span>
                <span>${(item.price.amount * item.amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="flex justify-between font-bold text-lg mb-6">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>

          <CheckoutForm
            defaultAddress={userAddress}
            locations={locationList}
            cartItems={items.map((item) => ({
              productId: item.productId,
              name: item.name,
              brand: item.brand,
              amount: item.amount,
              price: { amount: item.price.amount, currency: item.price.currency },
              image: { url: item.image.url },
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
