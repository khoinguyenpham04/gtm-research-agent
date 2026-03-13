import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clarion",
  description:
    "Clarion is an agentic go-to-market research workspace for document-grounded analysis, evidence validation, and executive-ready reporting.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
    shortcut: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ClerkProvider afterSignOutUrl="/">
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
