import type { Metadata } from "next";
import { Inter, Playfair_Display, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LayoutShell } from "@/components/layout-shell";
import { APP_NAME } from "@/lib/app-config";

// Huraqan design system: Inter for all UI, Playfair Display for the brand
// wordmark only, monospace kept for code/hex readouts.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Marketing, SEO, and content command center for law firms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full text-slate-900 bg-background">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
