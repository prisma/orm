import type { ReactNode } from 'react';
import { CartProvider } from '../src/components/cart-provider';
import { Navbar } from '../src/components/navbar';
import './globals.css';

export const metadata = {
  title: 'Retail Store — Prisma 8 MongoDB Demo',
  description: 'E-commerce example app powered by Prisma 8 with MongoDB',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CartProvider>
          <Navbar />
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </CartProvider>
      </body>
    </html>
  );
}
