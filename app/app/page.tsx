import { Suspense } from "react";
import Planner from "@/components/Planner";

export default function AppPage() {
  // useSearchParams を使う Client Component は Suspense で包む（Next 16 の作法）
  return (
    <Suspense fallback={<main className="shell"><p className="lede">読み込み中…</p></main>}>
      <Planner />
    </Suspense>
  );
}
