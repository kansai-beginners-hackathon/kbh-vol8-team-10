import Link from "next/link";

const STEPS = [
  { no: "まず", title: "みんなの帰る駅を入れる", body: "名前はあってもなくてもいい。駅だけでも動く。" },
  { no: "つぎに", title: "今夜の候補地を選ぶ", body: "四条か、京都駅か、烏丸御池か。迷ってる候補をぜんぶ入れる。" },
  { no: "すると", title: "いちばん長くいられる場所が出る", body: "全員が終電で帰れる中で、解散がいちばん遅くなる場所から順に並ぶ。" },
];

const DEMO_HREF = "/app?m=田中:鞍馬,佐藤:びわ湖浜大津,鈴木:大阪梅田,高橋:国際会館&v=shijo,kyoto,karasumaoike,sanjo,demachiyanagi";

export default function LandingPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="brand">もうちょっと</Link>
      </header>

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
        <span>データ: 京都市交通局ほか各社公開時刻表（モック段階ではダミー値）</span>
        <span>※ 遅延・運休・臨時ダイヤには対応しません</span>
      </footer>
    </main>
  );
}
