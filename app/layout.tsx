import "./globals.css";

import type { Metadata } from "next";
import ClientRoot from "./client-root";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FoodBuddy",
  description: "FoodBuddy starter app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
