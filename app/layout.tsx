import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Mirrio",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-black">{children}</body>
    </html>
  );
}
