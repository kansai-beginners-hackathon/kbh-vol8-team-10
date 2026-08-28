import type { Metadata } from "next";
import { Klee_One, Zen_Kaku_Gothic_New, Zen_Old_Mincho } from "next/font/google";
import "./globals.css";

const sans = Zen_Kaku_Gothic_New({ weight: ["400", "500", "700", "900"], subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Zen_Old_Mincho({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--font-serif", display: "swap" });
const hand = Klee_One({ weight: ["400", "600"], subsets: ["latin"], variable: "--font-hand", display: "swap" });

export const metadata: Metadata = {
  title: "もうちょっと｜この人数が一番長くいられる場所",
  description: "参加者の最寄り駅と候補地を入れると、全員が終電で帰れる中で一番長くいられる場所がわかります。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${sans.variable} ${serif.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
