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
    sapporo:  {name:"札幌", org:"jra", area:"jra", straight:{turf:266, dirt:264}},
    hakodate: {name:"函館", org:"jra", area:"jra", straight:{turf:262, dirt:260}},
    fukushima:{name:"福島", org:"jra", area:"jra", straight:{turf:292, dirt:296}},
    niigata:  {name:"新潟", org:"jra", area:"jra", straight:{turf:359, dirt:354}, outer:{turf:659}},
    tokyo:    {name:"東京", org:"jra", area:"jra", straight:{turf:526, dirt:502}},
    nakayama: {name:"中山", org:"jra", area:"jra", straight:{turf:310, dirt:308}},
    chukyo:   {name:"中京", org:"jra", area:"jra", straight:{turf:413, dirt:411}},
    kyoto:    {name:"京都", org:"jra", area:"jra", straight:{turf:328, dirt:329}, outer:{turf:404}},
    hanshin:  {name:"阪神", org:"jra", area:"jra", straight:{turf:357, dirt:353}, outer:{turf:474}},
    kokura:   {name:"小倉", org:"jra", area:"jra", straight:{turf:293, dirt:291}},
    // ---- 南関東（NAR） ---- いずれもダートのみ
    ooi:      {name:"大井",   org:"nar", area:"nankan", straight:{dirt:386}},
    kawasaki: {name:"川崎",   org:"nar", area:"nankan", straight:{dirt:300}},
    funabashi:{name:"船橋",   org:"nar", area:"nankan", straight:{dirt:308}},
    urawa:    {name:"浦和",   org:"nar", area:"nankan", straight:{dirt:220}},
    // ---- その他の地方競馬 ----
    // ばんえい（帯広）はソリを曳く直線200mの競走で、この予想モデルの
    // 前提（周回コースの脚質・枠順）が当てはまらないため対象外にしている。
    monbetsu: {name:"門別",   org:"nar", area:"chiho", straight:{dirt:330}},
    morioka:  {name:"盛岡",   org:"nar", area:"chiho", straight:{dirt:300, turf:300}},
    mizusawa: {name:"水沢",   org:"nar", area:"chiho", straight:{dirt:245}},
    kanazawa: {name:"金沢",   org:"nar", area:"chiho", straight:{dirt:236}},
    kasamatsu:{name:"笠松",   org:"nar", area:"chiho", straight:{dirt:201}},
    nagoya:   {name:"名古屋", org:"nar", area:"chiho", straight:{dirt:240}},
    sonoda:   {name:"園田",   org:"nar", area:"chiho", straight:{dirt:213}},
    himeji:   {name:"姫路",   org:"nar", area:"chiho", straight:{dirt:230}},
    kochi:    {name:"高知",   org:"nar", area:"chiho", straight:{dirt:200}},
    saga:     {name:"佐賀",   org:"nar", area:"chiho", straight:{dirt:200}}
  };

  const TRACK_KEYS = Object.keys(TRACKS);
  const JRA_KEYS = TRACK_KEYS.filter(k => TRACKS[k].org === "jra");
  const NAR_KEYS = TRACK_KEYS.filter(k => TRACKS[k].org === "nar");
  const NANKAN_KEYS = TRACK_KEYS.filter(k => TRACKS[k].area === "nankan");
  const CHIHO_KEYS  = TRACK_KEYS.filter(k => TRACKS[k].area === "chiho");

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
    /* 出走取消・除外の馬は走らない。オッズも付かないため、
       残したままだと市場推定勝率の分母が狂い、枠順の有利不利もずれる。 */
    hs = hs.filter(h => !h.scratched);
    if(!hs.length) return [];

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

    /* 能力指数 → モデル勝率（softmax）

       温度Tは固定せず、指数の広がりが市場の広がりと釣り合うように決める。
       Tを大きめに固定するとモデルの勝率が中央に潰れ、「勝ち目のない馬」を
       表現できなくなる。すると市場とのブレンドで極端な人気薄が機械的に
       持ち上がり、300倍の馬に「妙味」が付くといった誤りが出る。
       市場が横一線のときにモデルまで潰れないよう、市場側の広がりには下限を置く。 */
    const std = arr => {
      const m = arr.reduce((a,b)=>a+b, 0) / arr.length;
      return Math.sqrt(arr.reduce((a,b)=>a + (b-m)*(b-m), 0) / arr.length);
    };
    const marketSpread = Math.max(0.6, std(rows.map(x => Math.log(x.market))));
    const scoreSpread = std(rows.map(x => x.score));
    const T = Math.min(14, Math.max(4, scoreSpread / marketSpread));
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
    rows.temperature = T;
    rows.marketWeight = W;
    rows.race = r;
    rows.upset = upsetRisk(r, rows);
    return rows;
  }

  /* ============================================================
     荒れ度（波乱のリスク）
     ------------------------------------------------------------
     レースが荒れるのは偶然だけではなく、荒れやすい条件がある。
     予想の当たり外れとは別に、そのレースがどれだけ崩れやすいかを
     0〜100 で表し、買い方をそれに合わせる。

     大事なのは、荒れそうなときに強気になるのではなく、
     「推定勝率そのものが当てにならなくなる」と考えることである。
     したがって、点数は広げるが投入額はむしろ絞る。
     ============================================================ */
  const UPSET_HIGH = 60;
  const UPSET_MID  = 35;

  function upsetRisk(r, rows){
    const n = rows.length;
    const reasons = [];

    // 1) 混戦度。勝率分布のエントロピーを、完全な横一線を1として正規化する。
    let H = 0;
    rows.forEach(x => { if(x.prob > 0) H -= x.prob * Math.log(x.prob); });
    const flat = n > 1 ? H / Math.log(n) : 0;
    if(flat >= 0.93) reasons.push("上位の力が拮抗していて、勝ち馬を1頭に絞れません");

    // 2) ペース崩壊。逃げ馬が多いと前が総崩れになり、後ろから差が詰まる。
    const nige = rows.filter(x => x.h.style === "nige").length;
    const pace = nige >= 4 ? 1 : nige >= 3 ? 0.7 : nige >= 2 ? 0.35 : 0;
    if(nige >= 3) reasons.push(`逃げ馬が ${nige}頭 いてハイペースになりやすく、前が崩れる形です`);

    // 3) 道悪。能力より馬場適性が効き、実績どおりに走らない馬が増える。
    const cond = [0, 0.25, 0.6, 0.85][r && r.condition] || 0;
    if(r && r.condition >= 2) reasons.push("馬場が渋っていて、実績どおりに走らない馬が出ます");

    // 4) 多頭数。不利を受ける馬が増え、力どおりの決着になりにくい。
    const size = Math.min(1, Math.max(0, (n - 8) / 8));
    if(n >= 14) reasons.push(`${n}頭立てで、道中の不利を受ける馬が増えます`);

    // 5) 1番人気の危うさ。人気を被っている（期待値が1を割る）ほど崩れやすい。
    const fav = rows.slice().sort((a, b) => a.h.odds - b.h.odds)[0];
    const favRisk = fav ? Math.min(1, Math.max(0, (1.0 - fav.ev) / 0.4)) : 0;
    if(fav && fav.ev <= 0.80){
      reasons.push(`1番人気（${fav.h.num}番）の期待値が ${fav.ev.toFixed(2)} と低く、人気を被っています`);
    }

    const score = Math.round(100 * (0.34*flat + 0.20*pace + 0.18*cond + 0.10*size + 0.18*favRisk));
    const level = score >= UPSET_HIGH ? "high" : score >= UPSET_MID ? "mid" : "low";
    const label = {high:"荒れやすい", mid:"やや荒れる", low:"堅い"}[level];

    if(!reasons.length){
      reasons.push(level === "low"
        ? "崩れる要素が見当たらず、力どおりの決着になりやすい組み合わせです"
        : "決定的な波乱材料はありませんが、上位の差はそれほど大きくありません");
    }

    return {
      score: score, level: level, label: label, reasons: reasons,
      flat: Math.round(flat*100)/100, nige: nige,
      width: level === "high" ? 5 : level === "mid" ? 3 : 2,
      // 荒れるほど推定勝率の信頼度が落ちるので、投入額は絞る
      stakeScale: level === "high" ? 0.7 : level === "mid" ? 0.9 : 1.0,
      advice: upsetAdvice(level)
    };
  }

  /* 荒れ度に応じた買い方。実際の買い目もこの方針で組み立てる。 */
  function upsetAdvice(level){
    if(level === "high"){
      return [
        "軸を1頭に決め打ちせず、相手を5頭まで広げます。",
        "単勝の比重を下げ、ワイド・三連複で面を取ります（1点あたりを薄く、点数を多く）。",
        "推定勝率そのものが当てにならなくなる局面なので、投入額を3割減らします。",
        "人気馬の単勝で取り返そうとしないでください。荒れるレースほど人気馬の期待値は下がります。"
      ];
    }
    if(level === "mid"){
      return [
        "相手は3頭まで。ワイドを併用して取りこぼしを減らします。",
        "投入額を1割減らします。",
        "妙味馬（期待値1.10以上）が絡む買い目を1点だけ残します。"
      ];
    }
    return [
      "相手は2頭に絞ります。広げても必要オッズが上がるだけで割に合いません。",
      "単勝・馬連を中心に、点数を絞って厚く買います。",
      "三連複は出しません（点数のわりに必要オッズが高くなります）。"
    ];
  }

  /* ============================================================
     連対率・複勝率・連系馬券の的中確率（Harville モデル）
     ------------------------------------------------------------
     単勝の推定勝率だけが分かっているとき、「2着以内」「3着以内」や
     馬連・ワイド・三連複の的中確率を出すための標準的な近似。

       P(iが1着) = p_i
       P(iが1着、jが2着) = p_i × p_j/(1-p_i)
       P(i,j,k がこの順) = p_i × p_j/(1-p_i) × p_k/(1-p_i-p_j)

     「1着馬を除いた残りで、同じ比率のまま2着が決まる」と仮定している。
     実際には人気薄ほど複勝率が高く出る傾向（過小評価）があるので、
     出てくる確率は目安として扱う。買い目ごとの「必要オッズ」は
     この確率から計算しているため、同じだけの誤差を含む。
     ============================================================ */
  const SAFE = 1e-9;

  // i が k着以内に入る確率（k は 1〜3）
  function topKProb(p, i, k){
    const n = p.length;
    let s = p[i];
    if(k >= 2){
      for(let j = 0; j < n; j++){
        if(j === i) continue;
        s += p[j] * p[i] / Math.max(SAFE, 1 - p[j]);
      }
    }
    if(k >= 3){
      for(let j = 0; j < n; j++){
        if(j === i) continue;
        for(let m = 0; m < n; m++){
          if(m === i || m === j) continue;
          s += p[j] * (p[m] / Math.max(SAFE, 1 - p[j])) *
                      (p[i] / Math.max(SAFE, 1 - p[j] - p[m]));
        }
      }
    }
    return Math.min(1, s);
  }

  // 決まった順序で1〜3着に並ぶ確率
  function orderProb(p, a, b, c){
    let s = p[a] * p[b] / Math.max(SAFE, 1 - p[a]);
    if(c != null) s *= p[c] / Math.max(SAFE, 1 - p[a] - p[b]);
    return s;
  }

  // 馬連（1・2着を順不同で当てる）
  function quinellaProb(p, i, j){
    return orderProb(p, i, j) + orderProb(p, j, i);
  }

  // 三連複（3頭すべてが3着以内）
  function trioProb(p, i, j, k){
    return orderProb(p,i,j,k) + orderProb(p,i,k,j) + orderProb(p,j,i,k) +
           orderProb(p,j,k,i) + orderProb(p,k,i,j) + orderProb(p,k,j,i);
  }

  // ワイド（2頭がともに3着以内）
  function wideProb(p, i, j){
    let s = 0;
    for(let k = 0; k < p.length; k++){
      if(k === i || k === j) continue;
      s += trioProb(p, i, j, k);
    }
    // 3着に入る「もう1頭」で場合分けした和が、そのまま2頭同時の確率になる
    return Math.min(1, s);
  }

  /* 複勝の払戻対象。4頭以下は発売なし、5〜7頭は2着まで、8頭以上は3着まで。 */
  function placePositions(n){
    if(n <= 4) return 0;
    return n <= 7 ? 2 : 3;
  }

  /* ============================================================
     買い目
     ============================================================ */
  function unitAmount(total, points){
    if(points <= 0) return 0;
    return Math.max(100, Math.floor(total / points / 100) * 100);
  }

  /* ============================================================
     買い下限オッズ
     ------------------------------------------------------------
     締切間際のオッズの動きに追われる、という問題への答え。

     いちいち計算し直さなくても済むように、馬ごとに
     「これ以上のオッズが付いていれば単勝を買ってよい」という
     1つの数字を先に出しておく。あとは締切直前にオッズ表示を見て、
     その数字を上回っているかどうかだけを確かめればよい。

     オッズが動くと市場推定勝率も動くので、単純に 1÷推定勝率 では出せない
     （オッズが上がると推定勝率も下がる）。期待値はオッズに対して単調に
     増えるので、実際に analyze を回しながら期待値がちょうど1になる点を
     二分法で探す。近似式を置かず本体の計算をそのまま使うため、
     表示している推定勝率と必ず整合する。
     ============================================================ */
  function breakEvenOdds(r, hs, num){
    const live = hs.filter(h => !h.scratched);
    if(!live.some(h => h.num === num)) return null;

    const evAt = o => {
      const copy = live.map(h => h.num === num ? Object.assign({}, h, {odds: o}) : h);
      const x = analyze(r, copy).find(y => y.h.num === num);
      return x ? x.ev : 0;
    };

    const LO = 1.0, HI = 1000;
    if(evAt(LO) >= BUY_EV) return LO;      // どんなオッズでも買える馬
    if(evAt(HI) <  BUY_EV) return null;    // どれだけ付いても買えない馬

    // 対数で刻む（1倍と1000倍を同じ精度で扱うため）
    let lo = Math.log(LO), hi = Math.log(HI);
    for(let k = 0; k < 24; k++){
      const m = (lo + hi) / 2;
      if(evAt(Math.exp(m)) >= BUY_EV) hi = m; else lo = m;
    }
    const v = Math.exp(hi);
    // 表示に合わせて丸める。丸めで下回らないよう常に切り上げる。
    return v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v);
  }

  // 全馬ぶんまとめて求め、rows に minOdds として持たせる
  function fillBreakEven(r, hs, rows){
    rows.forEach(x => { x.minOdds = breakEvenOdds(r, hs, x.h.num); });
    return rows;
  }

  /* ---------- このレースを買うべきか ----------
     日本の馬券は控除率が20〜25%ある。市場をなぞるだけの予想では
     買った時点で必ず負ける。買う根拠があるのは、
     「推定勝率 × オッズ（＝期待値）が 1.0 を超える馬がいる」ときだけ。

     期待値は edge（市場比）と次の関係にある。
       EV = 推定勝率 × オッズ = edge ÷ Σ(1/オッズ)
     Σ(1/オッズ) は控除率の逆数（中央 約1.19／地方 約1.25）なので、
     市場比が 1.2 倍程度では期待値はやっと 1.0。「妙味」と呼べるのは
     そこからさらに上振れした馬だけになる。 */
  function raceGrade(rows){
    const info = rows.infoLevel != null ? rows.infoLevel : 0;
    // 推定勝率が低すぎる馬の期待値はモデルの精度を超えるので数えない
    const usable = rows.filter(x => x.prob >= 0.04);
    const bestEv = usable.length ? Math.max.apply(null, usable.map(x => x.ev)) : 0;
    const values = usable.filter(isValue);

    if(info < INFO_MIN){
      return {grade:"skip", stakeRatio:0, bestEv:bestEv,
              title:"見送り推奨",
              reason:`入力された材料が少なく（情報量 ${Math.round(info*100)}%）、` +
                     "予想がほぼオッズのなぞりになっています。この状態で買うと控除率のぶんだけ損をします。",
              advice:"近走着順・脚質・騎手評価を入れてから、もう一度計算してください。"};
    }
    if(bestEv < 1.0){
      return {grade:"skip", stakeRatio:0, bestEv:bestEv,
              title:"見送り推奨",
              reason:`期待値が 1.0 を超える馬がいません（最良でも ${bestEv.toFixed(2)}）。` +
                     "どの馬を買っても、長い目で見れば元本を割ります。",
              advice:"このレースは買わず、次のレースに資金を残すのが正解です。"};
    }
    if(bestEv >= 1.20 && info >= 0.6 && values.length){
      return {grade:"strong", stakeRatio:1.0, bestEv:bestEv,
              title:"勝負できる",
              reason:`期待値 ${bestEv.toFixed(2)} 倍の馬がいて、判断材料も揃っています（情報量 ${Math.round(info*100)}%）。`,
              advice:"予算どおりに買ってよいレースです。"};
    }
    if(bestEv >= 1.08){
      return {grade:"normal", stakeRatio:0.6, bestEv:bestEv,
              title:"買える（控えめに）",
              reason:`期待値 ${bestEv.toFixed(2)} 倍の馬がいます。ただし優位はわずかです。`,
              advice:"予算の6割にとどめるのが妥当です。"};
    }
    return {grade:"small", stakeRatio:0.3, bestEv:bestEv,
            title:"小額なら",
            reason:`期待値が 1.0 をわずかに超える馬しかいません（最良 ${bestEv.toFixed(2)}）。` +
                   "モデルの誤差に埋もれる大きさです。",
            advice:"買うなら予算の3割まで。見送っても構いません。"};
  }

  /* ---------- 買い目 ----------
     券種ごとに「的中確率」と「必要オッズ」を付ける。

     単勝だけは、入力されたオッズから期待値をそのまま計算できるので、
     期待値が1.0を超える馬に限って買う。本命だからという理由では買わない。

     馬連・ワイド・三連複はオッズを入力していないため、期待値を計算できない。
     代わりに的中確率から「これ以上のオッズが付いていれば買ってよい」という
     必要オッズを出す。n点を同額で買う場合、必要オッズ（平均）は

         必要オッズ = 点数 ÷ 的中確率の合計

     で決まる。実際のオッズがこれを下回るなら、その買い目は見送るべきである。 */
  function buildBets(rows, budget){
    const grade = raceGrade(rows);
    if(grade.grade === "skip"){
      return {bets: [], value: null, dropped: [], grade: grade,
              upset: rows.upset || null, spend: 0, budget: budget};
    }

    const probs = rows.map(x => x.prob);
    const idx = {};
    rows.forEach((x, i) => { idx[x.h.num] = i; });
    const n = rows.length;

    /* 軸はすべての買い目に入るので、その馬の割の良し悪しが全体に効く。
       単純に推定勝率1位を軸にすると、人気を被った馬（期待値が1を大きく割る馬）を
       全点数に入れることになる。上位3頭のなかで期待値がいちばん高い馬を軸にする。 */
    const top3 = rows.slice(0, Math.min(3, n));
    const axis = top3.slice().sort((x, y) => y.ev - x.ev)[0];
    const a = axis.h.num;
    const axisNote = axis.rank === 1 ? "" : `（本命 ${rows[0].h.num}番 は期待値 ${rows[0].ev.toFixed(2)} のため軸にしません）`;

    // 妙味馬（期待値が明確にプラスの、軸以外の馬）
    const value = rows
      .filter(x => x.h.num !== a && isValue(x) && x.rank <= Math.min(8, n))
      .sort((x, y) => y.ev - x.ev)[0];

    const bets = [];
    // prio は予算が足りないときに残す優先度（大きいほど残る）
    const push = (o) => { if(o.combos.length) bets.push(o); };
    const need = (hit, points) => (hit > 0 ? points / hit : Infinity);

    /* 買い目1点ごとの的中確率と必要オッズ。
       券種としての必要オッズは点数の平均でしかない。実際のオッズは点ごとに
       まったく違うので、平均だけでは「どの1点を外すべきか」が分からない。
       同額で買う場合、1点ごとの損益分岐は「その点の的中確率 × オッズ ＝ 1」
       なので、必要オッズは 1÷的中確率 になる。 */
    const withPoints = (combos, hits) => combos.map((c, k) => ({
      combo: c, hit: hits[k], needOdds: hits[k] > 0 ? 1 / hits[k] : Infinity
    }));

    /* 荒れるレースでは推定勝率そのものが当てにならなくなる。
       単勝（1頭に賭ける）の比重を下げ、面で取る券種に回す。 */
    const up = rows.upset || upsetRisk(rows.race, rows);
    const tanRatio = up.level === "high" ? 0.18 : up.level === "mid" ? 0.25 : 0.30;

    // --- 単勝：期待値が1.0を超える馬だけ、期待値の高い順に最大2頭 ---
    const tan = rows.filter(x => x.prob >= 0.04 && x.ev >= BUY_EV)
                    .sort((x, y) => y.ev - x.ev).slice(0, 2);
    tan.forEach((x, k) => {
      push({name: k === 0 ? "単勝" : "単勝（2頭目）", prio: 100 - k,
            ratio: k === 0 ? tanRatio : tanRatio / 2,
            combos: [String(x.h.num)], hit: x.prob, needOdds: 1 / x.prob, evKnown: x.ev,
            points: withPoints([String(x.h.num)], [x.prob]),
            memo: `推定勝率 ${(x.prob*100).toFixed(1)}% × ${x.h.odds.toFixed(1)}倍 ＝ 期待値 ${x.ev.toFixed(2)}`});
    });

    // --- 複勝：本命が堅い場合の取りこぼし防止 ---
    const places = placePositions(n);
    if(places){
      const ai = idx[a];
      const hit = topKProb(probs, ai, places);
      if(hit >= 0.5){
        push({name: `複勝（${places}着まで）`, prio: 85, ratio: 0.12,
              combos: [String(a)], hit: hit, needOdds: need(hit, 1),
              points: withPoints([String(a)], [hit]),
              memo: `${places}着以内 ${(hit*100).toFixed(0)}%。表示が ${need(hit,1).toFixed(1)}倍 以上なら買う価値があります`});
      }
    }

    // --- 相手の広げ方は荒れ度で決める（堅い2頭／やや荒れ3頭／荒れ5頭） ---
    const v = verdictOf(rows);
    const mates = rows.filter(x => x.h.num !== a).slice(0, up.width).map(x => x.h.num);

    if(mates.length){
      const combos = mates.map(x => `${a}-${x}`);
      const each = mates.map(m => quinellaProb(probs, idx[a], idx[m]));
      const hit = each.reduce((s, v) => s + v, 0);
      push({name: "馬連 流し", prio: 80, ratio: 0.20, combos: combos,
            hit: hit, needOdds: need(hit, combos.length),
            points: withPoints(combos, each),
            memo: `${a} 軸 → ${mates.join("・")}。的中 ${(hit*100).toFixed(1)}%${axisNote}`});
    }

    // ワイド・三連複は出走4頭以上でないと発売されない
    if(mates.length >= 2 && n >= 4){
      const w = mates.slice(0, 2);
      const combos = w.map(x => `${a}-${x}`);
      const each = w.map(m => wideProb(probs, idx[a], idx[m]));
      const hit = each.reduce((s, v) => s + v, 0);
      push({name: "ワイド", prio: 70, ratio: up.level === "high" ? 0.22 : 0.13, combos: combos,
            hit: hit, needOdds: need(hit, combos.length),
            points: withPoints(combos, each),
            memo: `堅めの押さえ。的中 ${(hit*100).toFixed(1)}%`});
    }

    // --- 三連複：点数が増えるほど必要オッズが上がるので、混戦のときだけ ---
    if(mates.length >= 3 && n >= 4 && up.level !== "low"){
      const tri = [], pairs = [];
      for(let i=0;i<mates.length;i++){
        for(let j=i+1;j<mates.length;j++){ tri.push(`${a}-${mates[i]}-${mates[j]}`); pairs.push([mates[i], mates[j]]); }
      }
      const each = pairs.map(pr => trioProb(probs, idx[a], idx[pr[0]], idx[pr[1]]));
      const hit = each.reduce((s, v) => s + v, 0);
      push({name: "三連複 軸1頭流し", prio: 60, ratio: up.level === "high" ? 0.28 : 0.20, combos: tri,
            hit: hit, needOdds: need(hit, tri.length),
            points: withPoints(tri, each),
            memo: `${a} 軸 → ${mates.join("・")}。的中 ${(hit*100).toFixed(1)}%`});
    }

    if(value && value.h.num !== a && n >= 4){
      const hit = wideProb(probs, idx[a], idx[value.h.num]);
      push({name: "ワイド（妙味）", prio: 40, ratio: 0.10, combos: [`${a}-${value.h.num}`],
            hit: hit, needOdds: need(hit, 1),
            points: withPoints([`${a}-${value.h.num}`], [hit]),
            memo: `期待値 ${value.ev.toFixed(2)} の ${value.h.num}番 を絡めた一撃`});
    }

    /* 実際に使う額。期待値の大きさ（レース評価）で決めたうえで、
       荒れやすいレースではさらに絞る。推定勝率が当てにならなくなるためで、
       点数を広げることと投入額を増やすことは別だという整理にしている。 */
    const spend = Math.max(100,
      Math.floor(budget * grade.stakeRatio * up.stakeScale / 100) * 100);

    // 1点100円が最低単位のため、点数が多いと予算を超えることがある。
    // 収まるまで優先度の低い券種から落とす。
    let live = bets.slice();
    const dropped = [];
    for(;;){
      const ratioSum = live.reduce((s, x) => s + x.ratio, 0);
      live.forEach(x => {
        const share = spend * (x.ratio / ratioSum);
        x.unit = unitAmount(share, x.combos.length);
        x.total = x.unit * x.combos.length;
      });
      const used = live.reduce((s, x) => s + x.total, 0);
      if(used <= spend || live.length <= 1) break;
      let worst = 0;
      for(let i=1;i<live.length;i++) if(live[i].prio < live[worst].prio) worst = i;
      dropped.push(live[worst].name);
      live.splice(worst, 1);
    }
    return {bets: live, value, dropped, grade: grade, upset: up,
            spend: spend, budget: budget};
  }

  /* ---------- 妙味・過剰人気の判定 ----------
     判定は期待値（推定勝率 × オッズ）で行う。市場比だけで見ると、
     控除率のぶんの下駄を無視することになる。市場比 1.20 倍は
     期待値でいえばちょうど 1.0 前後、つまり「やっと元が取れる」水準でしかない。

     もともと勝ち目のない馬での誤判定を防ぐため、比率に加えて
     勝率の絶対差も要求する。300倍の馬の 0.25% が 0.40% になっても
     比率は1.6倍だが差は0.15ポイントしかなく、モデルにその精度はない。 */
  const VALUE_EV   = 1.10;         // 期待値がこれ以上（＝10%以上の優位）
  const VALUE_GAP  = 0.005;        // かつ勝率で0.5ポイント以上の上乗せ
  const OVER_EV    = 0.70;
  const BUY_EV     = 1.00;         // 単勝を買う最低ライン（元本ちょうど）
  const INFO_MIN   = 0.35;         // これ未満の情報量では買わない

  function isValue(x){
    return x.ev >= VALUE_EV && (x.prob - x.market) >= VALUE_GAP;
  }
  function isOverbet(x){
    return x.ev <= OVER_EV && (x.market - x.prob) >= VALUE_GAP;
  }

  /* ---------- 総評 ---------- */
  /* 本命の信頼度。相手にする頭数は荒れ度（upsetRisk）が決めるので、
     ここでは「勝ち馬をどれだけ絞り込めているか」だけを述べる。 */
  function verdictOf(rows){
    const topProb = rows[0].prob;
    const gap = rows.length > 1 ? rows[0].prob - rows[1].prob : topProb;
    if(topProb >= 0.33 && gap >= 0.12){
      return {grade:"solid", title:"本命の信頼度は高い",
              sub:`推定勝率 ${(topProb*100).toFixed(0)}% で、2番手を ${(gap*100).toFixed(0)}ポイント引き離しています。`};
    }
    if(topProb >= 0.22){
      return {grade:"mid", title:"本命中心・やや堅め",
              sub:`推定勝率 ${(topProb*100).toFixed(0)}% の馬が抜けていますが、決め手には欠けます。`};
    }
    return {grade:"open", title:"勝ち馬を絞れない",
            sub:`最上位でも推定勝率 ${(topProb*100).toFixed(0)}% しかなく、上位の差が小さいレースです。`};
  }

  /* ---------- 出走馬の既定値 ---------- */
  function defaultHorse(num){
    return {num:num, name:"", odds:10,
            last1:0, last2:0, last3:0,
            jockey:3, training:3, dist:2, baba:2,
            kinryo:55, wdiff:0, style:"senko", scratched:false};
  }

  /* ---------- 想定ペースの自動判定 ---------- */
  function autoPace(hs){
    hs = hs.filter(h => !h.scratched);
    const nige  = hs.filter(h => h.style === "nige").length;
    const senko = hs.filter(h => h.style === "senko").length;
    let v = "mid";
    if(nige >= 3 || (nige >= 2 && senko >= 3)) v = "high";
    else if(nige === 0 && senko <= 2) v = "slow";
    return {pace:v, nige:nige, senko:senko};
  }

  return {
    TRACKS, TRACK_KEYS, JRA_KEYS, NAR_KEYS, NANKAN_KEYS, CHIHO_KEYS,
    STYLES, STYLE_LABEL, PACE_BONUS, MARKS, MARK_NAME,
    posScore, styleBonus, wakuBonus, straightOf, infoLevelOf,
    analyze, buildBets, unitAmount, verdictOf, defaultHorse, autoPace,
    raceGrade, topKProb, quinellaProb, wideProb, trioProb, placePositions,
    breakEvenOdds, fillBreakEven,
    upsetRisk, upsetAdvice, UPSET_HIGH, UPSET_MID,
    isValue, isOverbet, VALUE_EV, VALUE_GAP, OVER_EV, BUY_EV, INFO_MIN,
    MAX_FIELD: 18
  };
});
