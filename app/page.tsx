import Link from "next/link";

const STEPS = [
  { no: "まず", title: "みんなの帰る駅を入れる", body: "名前はあってもなくてもいい。駅だけでも動く。" },
  { no: "つぎに", title: "今夜の候補地を選ぶ", body: "四条か、京都駅か、烏丸御池か。迷ってる候補をぜんぶ入れる。" },
  { no: "すると", title: "いちばん長くいられる場所が出る", body: "全員が終電で帰れる中で、解散がいちばん遅くなる場所から順に並ぶ。" },
];

/**
 * デモ。4 人とも乗換なしでローカル時刻表から確定する（Transit を使わない）。
 *   鞍馬=叡電（出町柳） / 桂=阪急（京都河原町・烏丸） / 国際会館=地下鉄烏丸線 / 新田辺=近鉄（京都）
 * 実測（2026-08-30）: 出町柳 22:20 → 三条 22:12 → 烏丸御池 22:04 → 四条 22:02 → 京都駅 21:54。全候補地で田中（鞍馬 22:30 発）が詰む。平日・土日とも同値
 * 駅は data/prebuilt-stations.json に終電が焼いてあるものだけ（開いた瞬間に答えが出る）。d= を付けないとダイヤ未選択で計算されない。
 * 駅を変えたら scripts/export-prebuilt-stations.ts の DEMO_STATIONS も合わせて npm run data:prebuilt
 */
const DEMO_HREF = "/app?m=田中:鞍馬,佐藤:桂,鈴木:国際会館,高橋:新田辺&v=shijo,kyoto,karasumaoike,sanjo,demachiyanagi&d=weekend";

export default function LandingPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">今夜、どこで飲む？</p>
        <h1>みんなでいられる時間を、<em>もうちょっと<span className="maru">。</span></em></h1>
        <p className="lede">
          最寄り駅と候補地を入れるだけで、この人数が<b>一番長く一緒にいられる場所</b>がわかります。<br />
          ログイン不要。
        </p>
        <div className="hero-actions">
          <Link href="/app" className="btn btn-primary btn-lg">始める</Link>
          <Link href={DEMO_HREF} className="btn btn-ghost btn-lg">例を見る</Link>
        </div>
      </section>

      <section className="steps">
        {STEPS.map((step) => (
          <div className="panel step-card" key={step.no}>
            <span className="step">{step.no}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </div>
        ))}
      </section>

      <section className="insight panel">
        <div>
          <p className="eyebrow">たとえば、出町柳</p>
          <h2>「終電」は、駅ごとに違う。</h2>
          <p>
            駅に掲示されている最終列車は、途中の駅までしか行かないことがある。
            出町柳の掲示は 23:50 でも、鞍馬まで帰る人の本当の最終は 22:30。
            <b>80分</b> の差がある。
          </p>
        </div>
        <div className="truth">
          <span>出町柳・叡山電車</span>
          <b>掲示されている最終</b>
          <s className="num">23:50</s>
          <b>鞍馬に着く最終</b>
          <strong className="num">22:30</strong>
        </div>
      </section>

      <section className="closing">
        <h2>もうちょっといたいなら、<br />終電が遅い場所で遊べばええやん。</h2>
        <p>誰かの終電に合わせて解散するんじゃなくて、今日のメンツでいちばん長くいられる場所を選ぶ。それだけで、あと30分。</p>
        <Link href="/app" className="btn btn-primary btn-lg">始める</Link>
      </section>

      <footer>
        <span>時刻データは各交通事業者の公式時刻表と非公式 API による参考値です。実際の乗車前に公式情報をご確認ください。</span>
        <span>※ 遅延・運休・臨時ダイヤには対応しません</span>
      </footer>
    </main>
  );
}
