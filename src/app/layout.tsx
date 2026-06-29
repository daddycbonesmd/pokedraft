import type { Metadata } from "next";
import { Fraunces, Caveat } from "next/font/google";
import "./globals.css";
import BattleNotifier from "@/components/BattleNotifier";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PokéDraft",
  description: "Run Pokémon draft auctions with your friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${caveat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}<BattleNotifier /></body>
    </html>
  );
}
