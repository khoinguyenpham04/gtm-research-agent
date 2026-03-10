import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTM Research Agent",
  description: "GTM Research Agent Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
