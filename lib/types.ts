/** 支線に乗り換える駅（出町柳・三条・京都 など） */
export type HubId = string;

/** メンバーの帰着経路。ハブで支線に乗り換えて自宅駅へ帰る 1 通り */
export interface Route {
  hub: HubId;
  /** ハブに着いてから支線に乗るまでの乗換時間（分） */
  transferMin: number;
  /** ハブ発・自宅駅まで行く最終列車の発時刻 "HH:MM"（24時台は "24:05"）。null = 電車不要（制約なし） */
  last: string | null;
  /** どこから来た値か。UI のラベル用 */
  via: "local" | "transit";
  /** 乗換回数。2 以上は UI で「参考値」 */
  transferCount: number;
}

export interface Station {
  name: string;
  /** 複数ある場合は一番遅くなる経路が採用される */
  routes: Route[];
  /** タクシー概算用の直線距離（km）。0 = 未計測（表示しない） */
  taxiKm: number;
}

/** 候補地 → ハブ。Yahoo!乗換案内の終電検索から写す */
export interface HubCell {
  /** 所要時間 + 3 分（安全側）。最短ルートの所要を使う（最終便の大回りではない） */
  transitMin: number;
  /** 候補地発・そのハブまで行く最終の発時刻。候補地がハブそのものなら null（無制限） */
  lastDepart: string | null;
  /**
   * 候補地 → ハブに実際に走っている便。`[発, 着]` を新しい順に。data/venue-hub-trains.json から入る。
   *
   * 深夜は 15〜20 分に 1 本しか無いので、`支線最終 − transitMin − transferMin` で逆算すると
   * 「その時刻に電車が無い」答えになることがある（出町柳 → 桂: 逆算 23:52 だが乗れる最終は 23:42）。
   * これがあるときは、ハブに間に合って着く**実在の便**の中から一番遅いものを採る。
   *
   * 収録はおよそ 22 時以降の 6 本だけ。それより早い時間帯が締め切りになる人（叡電の鞍馬など）には
   * 該当便が無いので、その場合は従来どおり transitMin の逆算に戻る。
   */
  trains?: readonly (readonly [string, string])[];
}

export interface Venue {
  id: string;
  name: string;
  toHub: Partial<Record<HubId, HubCell>>;
}

export interface Member {
  name: string;
  station: string;
}

export interface MemberLeave {
  member: Member;
  /** 店を出られる最終時刻（分） */
  leave: number;
}

export type VenueResult =
  | { venue: Venue; ok: true; rows: MemberLeave[]; dissolve: number; bottleneck: Member }
  | { venue: Venue; ok: false; deadMember: Member };
