import type { ReactNode } from 'react';

export const metadata = {
  title: 'Better Auth with Prisma 8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '4rem auto' }}>
        {children}
      </body>
    </html>
  );
}
