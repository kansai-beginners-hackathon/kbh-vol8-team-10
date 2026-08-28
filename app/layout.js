import "./globals.css";

export const metadata = {
  title: "モウチョット｜みんなでいられる時間を計算",
  description: "参加者の終電から、解散時刻とおすすめの場所を計算します。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
