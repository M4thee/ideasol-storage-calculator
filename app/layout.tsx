import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kalkulator opłacalności instalacji fotowoltaicznej i magazynu energii | IdeaSol",
  description:
    "Sprawdź, czy fotowoltaika się opłaca oraz czy magazyn energii ma sens w Twoim domu. Bezpłatny kalkulator opłacalności PV i magazynu energii.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Kalkulator opłacalności instalacji fotowoltaicznej i magazynu energii | IdeaSol",
    description:
      "Sprawdź, czy fotowoltaika się opłaca oraz czy magazyn energii ma sens w Twoim domu. Bezpłatny kalkulator opłacalności PV i magazynu energii.",
    url: "https://magazyny.ideasol.pl",
    siteName: "IdeaSol",
    locale: "pl_PL",
    type: "website",
  },
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
