import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '../../src/components/ui/badge';
import { Card, CardContent } from '../../src/components/ui/card';
import { getUserOrders } from '../../src/data/orders';
import { getDb } from '../../src/db';
import { getAuthUserId } from '../../src/lib/auth';

export const dynamic = 'force-dynamic';

const statusVariant: Record<string, 'default' | 'warning' | 'success' | 'destructive'> = {
  placed: 'default',
  shipped: 'warning',
  delivered: 'success',
  cancelled: 'destructive',
};

export default async function OrdersPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect('/login');

  const db = await getDb();
  const orders = await getUserOrders(db, userId);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Order History</h1>

      {orders.length === 0 ? (
        <p className="text-muted text-center py-12">No orders yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const lastStatus = order.statusHistory[order.statusHistory.length - 1];
            const total = order.items.reduce(
              (sum, item) => sum + item.price.amount * item.amount,
              0,
            );
            const status = lastStatus?.status;
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="no-underline text-inherit"
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="flex items-center justify-between p-5">
                    <div>
                      <p className="font-semibold">
                        {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                      </p>
                      <p className="text-sm text-muted">{order.shippingAddress}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      {status && (
                        <Badge variant={statusVariant[status] ?? 'outline'}>{status}</Badge>
                      )}
                      <span className="font-semibold">${total.toFixed(2)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
