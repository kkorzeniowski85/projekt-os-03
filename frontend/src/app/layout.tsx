import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Literata } from "next/font/google";
import "./globals.css";

import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin-ext"] });

// Tresc fiszki jest szeryfowa - Literata jest zaprojektowana do czytania
// dluzszych tekstow na ekranie i oddziela material od interfejsu.
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin-ext"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
});

// Sciezki podane recznie w metadanych NIE sa prefiksowane przez Next -
// w odroznieniu od <Link> i assetow. Na hostingu w podkatalogu manifest
// bez prefiksu wskazuje na korzen cudzej domeny i telefon go nie znajduje,
// wiec nie proponuje instalacji.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Fiszki",
  description: "Fiszki z powtórkami rozłożonymi w czasie (FSRS)",
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
  // Pasek systemowy dopasowany do tla aplikacji, osobno dla dnia i nocy.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#12100e" },
  ],
  // Bez tego dwuklik w przycisk oceny zoomuje strone zamiast oceniac.
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
      className={`${geistSans.variable} ${geistMono.variable} ${literata.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
