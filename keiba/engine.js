/* ============================================================
   Turf Logic — 予想エンジン（共有モジュール）
   Node.js（CLI）とブラウザ（HTMLアプリ）の両方から読み込まれる。
   予想ロジックの正はこのファイルだけであり、HTMLアプリには
   build.js がこの中身をそのまま埋め込む。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 競馬場データ ----------
     straight: 各馬場の直線距離(m)。脚質補正とコース形態の判定に使う。
     出典は各主催者の公式コース図。外回りがある場合は course:"outer" で切り替える。 */
  const TRACKS = {
    // ---- 中央（JRA） ----
    sapporo:  {name:"札幌", org:"jra", straight:{turf:266, dirt:264}},
    hakodate: {name:"函館", org:"jra", straight:{turf:262, dirt:260}},
    fukushima:{name:"福島", org:"jra", straight:{turf:292, dirt:296}},
    niigata:  {name:"新潟", org:"jra", straight:{turf:359, dirt:354}, outer:{turf:659}},
    tokyo:    {name:"東京", org:"jra", straight:{turf:526, dirt:502}},
    nakayama: {name:"中山", org:"jra", straight:{turf:310, dirt:308}},
    chukyo:   {name:"中京", org:"jra", straight:{turf:413, dirt:411}},
    kyoto:    {name:"京都", org:"jra", straight:{turf:328, dirt:329}, outer:{turf:404}},
    hanshin:  {name:"阪神", org:"jra", straight:{turf:357, dirt:353}, outer:{turf:474}},
    kokura:   {name:"小倉", org:"jra", straight:{turf:293, dirt:291}},
    // ---- 南関東（NAR） ---- いずれもダートのみ
    ooi:      {name:"大井",   org:"nar", straight:{dirt:386}},
    kawasaki: {name:"川崎",   org:"nar", straight:{dirt:300}},
    funabashi:{name:"船橋",   org:"nar", straight:{dirt:308}},
    urawa:    {name:"浦和",   org:"nar", straight:{dirt:220}}
  };

  const TRACK_KEYS = Object.keys(TRACKS);
  const JRA_KEYS = TRACK_KEYS.filter(k => TRACKS[k].org === "jra");
  const NAR_KEYS = TRACK_KEYS.filter(k => TRACKS[k].org === "nar");

  const STYLES = [
    {v:"nige",   label:"逃げ"},
    {v:"senko",  label:"先行"},
    {v:"sashi",  label:"差し"},
    {v:"oikomi", label:"追込"}
  ];
  const STYLE_LABEL = {};
  STYLES.forEach(s => { STYLE_LABEL[s.v] = s.label; });

  // 想定ペース × 脚質（コース形態とは独立した、その日の流れの分）
  const PACE_BONUS = {
    high: {nige:-4.5, senko:-1.5, sashi:2.5, oikomi:4.0},
    mid:  {nige: 1.0, senko: 1.5, sashi:0.0, oikomi:-1.5},
    slow: {nige: 4.0, senko: 2.5, sashi:-2.0, oikomi:-4.0}
  };

  const MARKS = ["◎","○","▲","△","△"];
  const MARK_NAME = ["本命","対抗","単穴","連下","連下"];

  const STRAIGHT_BASE = 350;   // 脚質補正の基準となる直線長(m)

  /* ---------- 補助 ---------- */
  function trackOf(r){ return TRACKS[r && r.track] || null; }

  // そのレース条件での直線距離。未知の競馬場は基準値にフォールバックする。
  function straightOf(r){
    const t = trackOf(r);
    if(!t) return STRAIGHT_BASE;
    if(r.course === "outer" && t.outer && t.outer[r.surface] != null) return t.outer[r.surface];
    const s = t.straight[r.surface];
    if(s != null) return s;
    // 南関にはダートしかないため、芝を指定された場合もダートの値で扱う
    return t.straight.dirt != null ? t.straight.dirt : STRAIGHT_BASE;
  }

  // 近走着順 → 0〜10点。0（出走なし）は平均的に扱う。
  function posScore(p){
    if(!p || p <= 0) return 4.0;
    if(p >= 8) return 0;
    return Math.max(0, 10 - (p - 1) * 1.6);
  }

  /* ---------- 脚質補正 ----------
     ペースの分に加えて、直線の長短とダート適性（南関）を反映する。 */
  function styleBonus(r, style){
    const pace = (PACE_BONUS[r.pace] || PACE_BONUS.mid)[style] || 0;
    const t = trackOf(r);
    const k = (straightOf(r) - STRAIGHT_BASE) / 100;   // 東京芝 +1.76 / 浦和 -1.30
    const front = (style === "nige" || style === "senko");
    const shape = (front ? -k : k) * 1.6;
    // 南関の小回りダートは前が止まりにくく、砂を被る差し・追込が不利になりやすい
    const nar = (t && t.org === "nar")
      ? ({nige:1.5, senko:1.0, sashi:-0.8, oikomi:-1.5})[style] || 0
      : 0;
    return pace + shape + nar;
  }

  /* ---------- 枠順補正 ---------- */
  function wakuBonus(r, h, n){
    const t = trackOf(r);
    const rel = n > 1 ? (h.num - 1) / (n - 1) : 0.5;      // 0=最内 1=大外
    const tight = Math.max(0, (STRAIGHT_BASE - straightOf(r)) / 100); // 小回りほど大きい
    let b = (0.5 - rel) * (1.2 + tight * 2.2);            // 小回りほど内枠有利が強まる
    // 中央のダートは砂を被らない外めがやや有利
    if(r.surface === "dirt" && t && t.org === "jra") b += (rel - 0.5) * 1.6;
    // 芝の短距離は内枠の距離ロスの少なさが効く
    if(r.surface === "turf" && r.distance <= 1400) b += (0.5 - rel) * 1.4;
    return b;
  }

  /* ---------- 情報量 ----------
     入力がどれだけ埋まっているかを 0〜1 で表す。
     既定値のままの項目が多いと能力指数はほぼ横並びになり、
     そのまま市場とブレンドすると人気薄が機械的に持ち上がって
     「妙味」の偽シグナルが出る。これを防ぐために市場の重みへ反映する。 */
  function infoLevelOf(hs){
    const n = hs.length;
    if(!n) return 0;
    const formN = hs.filter(h => h.last1 > 0 || h.last2 > 0 || h.last3 > 0).length;
    const rateN = hs.filter(h => h.jockey !== 3 || h.training !== 3 || h.dist !== 2 || h.baba !== 2).length;
    const styleVar = new Set(hs.map(h => h.style)).size > 1 ? 1 : 0;
    return 0.5 * (formN / n) + 0.3 * (rateN / n) + 0.2 * styleVar;
  }

  /* ============================================================
     本体：能力指数 → 推定勝率
     ============================================================ */
  function analyze(r, hs){
    // 市場推定勝率（控除率を除くため合計1に正規化）
    const impl = hs.map(h => 1 / Math.max(1.0, h.odds));
    const implSum = impl.reduce((a,b)=>a+b, 0);

    const avgKinryo = hs.reduce((a,h)=>a+h.kinryo, 0) / hs.length;
    const n = hs.length;

    // 能力指数はオッズを含めずに算出する（市場評価は後段でブレンドする）
    const rows = hs.map((h, i) => {
      const parts = {};

      // 1) 近走フォーム（0〜25）
      const form = 0.5*posScore(h.last1) + 0.3*posScore(h.last2) + 0.2*posScore(h.last3);
      parts.form = form * 2.5;

      // 2) 騎手（0〜10）・調教（0〜10）
      parts.jockey   = (h.jockey   - 1) / 4 * 10;
      parts.training = (h.training - 1) / 4 * 10;

      // 3) 適性（距離0〜8／馬場は道悪ほど比重が上がる）
      parts.dist = h.dist / 3 * 8;
      const babaWeight = 4 + r.condition * 1.0;
      parts.baba = (h.baba / 3) * babaWeight - babaWeight/2;

      // 4) 展開（ペース × 脚質 × コース形態）
      parts.pace = styleBonus(r, h.style);

      // 5) 斤量（平均より重いほどマイナス）
      parts.kinryo = -(h.kinryo - avgKinryo) * 1.4;

      // 6) 馬体重増減（-4〜+8kg を適正圏とする）
      let w = 0;
      if(h.wdiff < -4) w = (h.wdiff + 4) * 0.35;
      else if(h.wdiff > 8) w = -(h.wdiff - 8) * 0.35;
      parts.weight = Math.max(-4, w);

      // 7) 枠順
      parts.waku = wakuBonus(r, h, n);

      const score = Object.keys(parts).reduce((a,k)=>a+parts[k], 0);
      return {h, parts, score, market: impl[i] / implSum};
    });

    // 能力指数 → モデル勝率（softmax）
    const T = 11;
    const maxScore = Math.max.apply(null, rows.map(x => x.score));
    const exps = rows.map(x => Math.exp((x.score - maxScore) / T));
    const expSum = exps.reduce((a,b)=>a+b, 0);
    rows.forEach((x, i) => { x.model = exps[i] / expSum; });

    // モデル勝率 × 市場勝率 の幾何ブレンド
    // オッズは極めて強い予測子なので、単独モデルを市場で補正して過信を防ぐ。
    // 市場の重みは入力の情報量で決まる。判断材料がなければ市場そのもの（W=1）に
    // 収束し、根拠のない「妙味」を出さない。
    const info = infoLevelOf(hs);
    const W = 1 - 0.45 * info;                       // 情報量1.0 → 0.55 / 0 → 1.00
    const bl = rows.map(x => Math.pow(x.market, W) * Math.pow(x.model, 1 - W));
    const blSum = bl.reduce((a,b)=>a+b, 0);
    rows.forEach((x, i) => {
      x.prob = bl[i] / blSum;
      x.ev   = x.prob * x.h.odds;      // 単勝の期待回収率
      x.edge = x.prob / x.market;      // 市場評価との乖離（1.00＝市場並み）
    });

    rows.sort((a,b) => b.prob - a.prob);
    rows.forEach((x, i) => { x.rank = i + 1; });
    rows.infoLevel = info;
    rows.marketWeight = W;
    return rows;
  }

  /* ============================================================
     買い目
     ============================================================ */
  function unitAmount(total, points){
    if(points <= 0) return 0;
    return Math.max(100, Math.floor(total / points / 100) * 100);
  }

  function buildBets(rows, budget){
    const pick = rows.slice(0, Math.min(5, rows.length));
    const nums = pick.map(x => x.h.num);
    const a = nums[0], b = nums[1], c = nums[2], d = nums[3];

    // 妙味馬（市場評価より高く評価できる馬。本命以外・オッズ4倍以上）
    const value = rows
      .filter(x => x.h.num !== a && x.h.odds >= 4 && x.edge >= 1.15 && x.rank <= Math.min(8, rows.length))
      .sort((x, y) => y.edge - x.edge)[0];

    const bets = [];
    // prio は予算が足りないときに残す優先度（大きいほど残る）
    const push = (name, prio, ratio, combos, memo) => {
      if(combos.length) bets.push({name, prio, ratio, combos, memo});
    };

    push("単勝", 100, 0.22, [String(a)], "本命の単勝勝負");
    if(value) push("単勝（妙味）", 50, 0.08, [String(value.h.num)], `市場評価比 ${value.edge.toFixed(2)} 倍の過小評価馬`);
    push("複勝", 90, 0.12, [String(a)], "軸の保険");

    if(b){
      push("馬連 流し", 80, 0.22, nums.slice(1).map(x => `${a}-${x}`), `${a} 軸 → ${nums.slice(1).join("・")}`);
    }
    if(c){
      push("ワイド", 70, 0.14, [`${a}-${b}`, `${a}-${c}`], "堅めの押さえ");
    }
    if(d){
      const tri = [];
      for(let i=1;i<nums.length;i++){
        for(let j=i+1;j<nums.length;j++) tri.push(`${a}-${nums[i]}-${nums[j]}`);
      }
      push("三連複 軸1頭流し", 60, 0.22, tri, `${a} 軸 → 相手 ${nums.slice(1).join("・")}`);
    }
    if(value && b){
      push("ワイド（妙味）", 40, 0.10, [`${a}-${value.h.num}`], "穴目の一撃");
    }

    // 1点100円が最低単位のため、点数が多いと予算を超えることがある。
    // 収まるまで優先度の低い券種から落とす。
    let live = bets.slice();
    const dropped = [];
    for(;;){
      const ratioSum = live.reduce((s, x) => s + x.ratio, 0);
      live.forEach(x => {
        const share = budget * (x.ratio / ratioSum);
        x.unit = unitAmount(share, x.combos.length);
        x.total = x.unit * x.combos.length;
      });
      const spent = live.reduce((s, x) => s + x.total, 0);
      if(spent <= budget || live.length <= 1) break;
      let worst = 0;
      for(let i=1;i<live.length;i++) if(live[i].prio < live[worst].prio) worst = i;
      dropped.push(live[worst].name);
      live.splice(worst, 1);
    }
    return {bets: live, value, dropped};
  }

  /* ---------- 総評 ---------- */
  function verdictOf(rows){
    const topProb = rows[0].prob;
    const gap = rows[0].prob - rows[1].prob;
    if(topProb >= 0.33 && gap >= 0.12){
      return {title:"堅い決着が濃厚",
              sub:"本命の信頼度が高く、軸を固定した組み立てが有効です。"};
    }
    if(topProb >= 0.22){
      return {title:"本命中心・やや堅め",
              sub:"本命を軸に、相手を3〜4頭まで広げるのが妥当です。"};
    }
    return {title:"混戦・波乱含み",
            sub:"上位のスコア差が小さいレースです。点数を絞りすぎず、妙味馬を絡めた買い方が有効です。"};
  }

  /* ---------- 出走馬の既定値 ---------- */
  function defaultHorse(num){
    return {num:num, name:"", odds:10,
            last1:0, last2:0, last3:0,
            jockey:3, training:3, dist:2, baba:2,
            kinryo:55, wdiff:0, style:"senko"};
  }

  /* ---------- 想定ペースの自動判定 ---------- */
  function autoPace(hs){
    const nige  = hs.filter(h => h.style === "nige").length;
    const senko = hs.filter(h => h.style === "senko").length;
    let v = "mid";
    if(nige >= 3 || (nige >= 2 && senko >= 3)) v = "high";
    else if(nige === 0 && senko <= 2) v = "slow";
    return {pace:v, nige:nige, senko:senko};
  }

  return {
    TRACKS, TRACK_KEYS, JRA_KEYS, NAR_KEYS,
    STYLES, STYLE_LABEL, PACE_BONUS, MARKS, MARK_NAME,
    posScore, styleBonus, wakuBonus, straightOf, infoLevelOf,
    analyze, buildBets, unitAmount, verdictOf, defaultHorse, autoPace,
    MAX_FIELD: 18
  };
});
