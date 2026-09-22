'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../src/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', { method: 'POST' });
      if (res.ok) {
        router.push('/');
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Retail Store</CardTitle>
          <CardDescription>Prisma 8 MongoDB Demo</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted text-center">
            Sign up to browse products, manage your cart, and place orders.
          </p>
          <Button onClick={handleSignUp} disabled={loading} className="w-full">
            {loading ? 'Creating account...' : 'Sign Up'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
