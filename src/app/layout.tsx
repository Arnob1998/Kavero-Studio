import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brand } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: brand.name,
  description: brand.description,
  applicationName: brand.name,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
