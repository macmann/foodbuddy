import './globals.css';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FoodBuddy',
  description: 'FoodBuddy starter app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
