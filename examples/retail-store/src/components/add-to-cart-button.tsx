'use client';

import { useRef, useState } from 'react';
import { useCart } from './cart-provider';
import { Button } from './ui/button';

interface AddToCartButtonProps {
  product: {
    id: string;
    name: string;
    brand: string;
    price: { amount: number; currency: string };
    image: { url: string };
  };
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { invalidateCart } = useCart();
  const [state, setState] = useState<'idle' | 'loading' | 'added'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function handleAdd() {
    clearTimeout(timerRef.current);
    setState('loading');
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          name: product.name,
          brand: product.brand,
          amount: 1,
          price: product.price,
          image: product.image,
        }),
      });
      if (!res.ok) throw new Error(`Add to cart failed (${res.status})`);
      invalidateCart();
      setState('added');
      timerRef.current = setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('idle');
    }
  }

  return (
    <Button onClick={handleAdd} disabled={state === 'loading'} className="w-full">
      {state === 'loading' ? 'Adding...' : state === 'added' ? 'Added!' : 'Add to Cart'}
    </Button>
  );
}
