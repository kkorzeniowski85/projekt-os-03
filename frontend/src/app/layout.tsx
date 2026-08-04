import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin-ext"] });

// Sciezki podane recznie w metadanych NIE sa prefiksowane przez Next -
// w odroznieniu od <Link> i assetow. Na hostingu w podkatalogu manifest
// bez prefiksu wskazuje na korzen cudzej domeny i telefon go nie znajduje,
// wiec nie proponuje instalacji.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Fiszki",
  description: "Fiszki z powtorkami rozlozonymi w czasie (FSRS)",
  manifest: `${BASE}/manifest.webmanifest`,
  icons: {
    apple: `${BASE}/apple-touch-icon.png`,
  },
  // iOS nie czyta manifestu przy dodawaniu do ekranu glownego - potrzebuje
  // wlasnych metatagow, zeby aplikacja odpalila sie bez paska Safari.
  appleWebApp: {
    capable: true,
    title: "Fiszki",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#4338ca",
  // Bez tego dwuklik w przycisk oceny na iOS zoomuje strone zamiast oceniac.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
