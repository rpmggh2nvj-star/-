/* ============================================================
   Turf Logic — 記録から学ぶ
   ------------------------------------------------------------
   着順を入れた記録から、次の2つを当てはめ直す。

     1. 項目ごとの重み（近走・騎手・調教・距離・馬場・展開・斤量・
        馬体重増減・枠順）を、既定を 1.00 とする倍率で
     2. 自分の見立てと市場（オッズ）をどの割合で混ぜるか

   考え方は競馬の予想モデルで標準的な二段構えにしている。
     第1段：能力の項目だけで「勝つ確率」を当てはめる（条件付きロジット）
     第2段：それを市場の勝率と混ぜる割合を当てはめる
   分けるのは、まとめて当てはめると市場が強すぎて項目側の手がかりが
   埋もれてしまうためである。

   ------------------------------------------------------------
   少ない記録で学ぶときにいちばん危ないのは、たまたま当たった
   数レースに合わせて重みが飛ぶことである。これを防ぐために:

     ・重みは既定（1.00）に引き戻す力をかけながら当てはめる。
       引き戻す力はレース数に反比例させてあるので、記録が増えるほど
       データの言い分が通るようになる（＝使うほど効いてくる）。
     ・当てはめに使っていないレースで検算し、既定より良くなっていない
       ときは採用しない。「学習したのに悪くなる」を起こさないため。

   予想そのものは書き換えない。学ぶのは次のレースの見方だけで、
   過去の記録は当時の予想のまま残る。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./engine.js"));
  else root.TurfLearn = factory(root.TurfEngine);
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  const MIN_RACES   = 20;    // これ未満では当てはめない（偶然に合わせるだけになる）
  const GOOD_RACES  = 60;    // このあたりから重みが実際に動きはじめる
  const LAMBDA      = 9.0;   // 既定へ引き戻す力（レース数で割って効かせる）
  const W_MIN = 0.40, W_MAX = 2.20;   // 倍率の可動域
  const B_MIN = 0.00, B_MAX = 0.90;   // ブレンドの可動域
  const GAIN_MIN = 0.004;    // 検算でこれだけ良くならなければ採用しない
  /* 混ぜ方（blend）は1つの数字なのに、少ない記録では大きく振れる。
     検算で分けて測ったところ、記録が少ないときに成績を落としていたのは
     項目の重みではなくこちらだった（25レースで −0.049 対 −0.002）。
     そのため、記録が BLEND_GATE に届くまでは動かさず、動かしたあとも
     既定へ引き戻す。BLEND_K が大きいほど強く引き戻る。 */
  /* 改善が偶然でないと言えるかの目安（改善 ÷ 標準誤差）。
     1.6 はおおむね「95%の片側」に相当する。 */
  const T_MIN = 1.6;
  const BLEND_GATE = 80;
  const BLEND_K    = 120;
  const VERSION = 1;

  const KEYS = E.PART_KEYS;

  /* ---------- 記録 → 学習に使える形 ---------- */
  function samples(records){
    const out = [];
    (records || []).forEach(r => {
      if(!r || !r.result || !(r.result.first > 0)) return;
      const pred = r.pred || [];
      if(pred.length < 4) return;                       // 少頭数は手がかりが乏しい
      if(!pred.every(p => p && p.parts && typeof p.market === "number" && p.market > 0)) return;
      const win = pred.findIndex(p => p.num === r.result.first);
      if(win < 0) return;                               // 1着馬が予想に無い（取消など）
      const info = (typeof r.infoLevel === "number") ? r.infoLevel : null;
      if(info == null) return;                          // 混ぜ方を再現できない
      out.push({
        id: r.id,
        parts: pred.map(p => p.parts),
        market: pred.map(p => p.market),
        odds: pred.map(p => p.odds),
        info: info,
        win: win,
        // 2着・3着も分かれば、複勝側の検算に使える
        place: [r.result.first, r.result.second, r.result.third]
          .filter(n => n > 0)
          .map(n => pred.findIndex(p => p.num === n))
          .filter(i => i >= 0)
      });
    });
    return out;
  }

  /* ---------- 1レースぶんの確率を出し直す ----------
     engine の scoreOf / blendProbs をそのまま使う。学習と予想で
     計算が食い違わないようにするため、ここに式は書かない。 */
  function probsOf(s, tune){
    const scores = s.parts.map(p => E.scoreOf(p, tune));
    return E.blendProbs(scores, s.market, s.info, tune);
  }

  /* 1着馬に与えた確率の対数損失。小さいほど当てられている。 */
  function loss(ss, tune, useModelOnly){
    if(!ss.length) return 0;
    let sum = 0;
    for(let i = 0; i < ss.length; i++){
      const b = probsOf(ss[i], tune);
      const p = (useModelOnly ? b.model : b.prob)[ss[i].win];
      sum -= Math.log(Math.max(1e-12, p));
    }
    return sum / ss.length;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const copyW = w => { const o = {}; KEYS.forEach(k => { o[k] = w[k]; }); return o; };

  /* 倍率は全体を何倍しても softmax の温度が吸収してしまう（＝答えが1つに
     決まらない）。平均を1にそろえて、比だけを意味のある量にする。 */
  function normalizeW(w){
    let s = 0;
    KEYS.forEach(k => { s += w[k]; });
    const m = s / KEYS.length;
    if(!(m > 0)) return w;
    KEYS.forEach(k => { w[k] = clamp(w[k] / m, W_MIN, W_MAX); });
    return w;
  }

  /* ---------- 第1段：項目ごとの重み ----------
     1項目ずつ動かして良くなる方向に寄せる（座標降下）。
     項目が9つと少なく、レース数も多くないので、これで十分速く収まる。 */
  function fitWeights(ss, opt){
    opt = opt || {};
    const lam = (opt.lambda != null ? opt.lambda : LAMBDA) / Math.max(1, ss.length);
    const w = {};
    KEYS.forEach(k => { w[k] = 1; });

    const penalty = ww => {
      let s = 0;
      KEYS.forEach(k => { const d = ww[k] - 1; s += d * d; });
      return lam * s;
    };
    const obj = ww => loss(ss, {weights: ww}, true) + penalty(ww);

    let best = obj(w);
    let step = 0.32;
    for(let round = 0; round < 24 && step > 0.01; round++){
      let moved = false;
      for(let i = 0; i < KEYS.length; i++){
        const k = KEYS[i];
        const cur = w[k];
        for(const d of [step, -step]){
          const trial = copyW(w);
          trial[k] = clamp(cur + d, W_MIN, W_MAX);
          if(trial[k] === cur) continue;
          normalizeW(trial);
          const v = obj(trial);
          if(v < best - 1e-9){
            best = v; KEYS.forEach(kk => { w[kk] = trial[kk]; }); moved = true;
            break;
          }
        }
      }
      if(!moved) step *= 0.5;
    }
    return {weights: normalizeW(w), loss: best};
  }

  /* ---------- 第2段：市場とどれだけ混ぜるか ----------
     W = 1 − blend × 情報量。blend が 0 なら市場そのもの、
     大きいほど自分の見立てに寄せる。1変数なので総当たりで足りる。 */
  function fitBlend(ss, weights, opt){
    opt = opt || {};
    const gate = opt.gate != null ? opt.gate : BLEND_GATE;
    if(ss.length < gate){
      return {blend: null, loss: loss(ss, {weights: weights}, false), held: true};
    }
    let bestB = E.BLEND_BASE, best = Infinity;
    for(let b = B_MIN; b <= B_MAX + 1e-9; b += 0.05){
      const v = loss(ss, {weights: weights, blend: b}, false);
      if(v < best){ best = v; bestB = b; }
    }
    // 既定へ引き戻す。記録が増えるほど、当てはめた値がそのまま通る。
    const K = opt.k != null ? opt.k : BLEND_K;
    const pulled = E.BLEND_BASE + (bestB - E.BLEND_BASE) * ss.length / (ss.length + K);
    const v = clamp(Math.round(pulled * 100) / 100, B_MIN, B_MAX);
    return {blend: v, raw: Math.round(bestB * 100) / 100,
            loss: loss(ss, {weights: weights, blend: v}, false)};
  }

  /* ---------- 検算 ----------
     当てはめに使っていないレースで、既定より良くなっているかを見る。
     記録が少ないうちは1レースずつ抜き、増えたら5分割にする。

     大事なのは「良くなったか」ではなく「良くなったと言えるか」である。
     24レースで試すと、改善が出るか出ないかは種を変えるだけで
     ひっくり返った（+0.016 / +0.010 / +0.007 / −0.005 / −0.003）。
     平均が正でも、それがばらつきの範囲内なら偶然でしかない。
     そこでレースごとの改善幅の標準誤差も出し、
     採用の判断はそれを超えているかどうかで行う。 */
  function crossValidate(ss, opt){
    const k = ss.length < 40 ? Math.min(ss.length, 10) : 5;
    const folds = [];
    for(let i = 0; i < k; i++) folds.push([]);
    ss.forEach((s, i) => { folds[i % k].push(s); });

    const gains = [];
    let base = 0, tuned = 0, n = 0;
    for(let i = 0; i < k; i++){
      const test = folds[i];
      if(!test.length) continue;
      const train = [];
      for(let j = 0; j < k; j++) if(j !== i) train.push.apply(train, folds[j]);
      if(train.length < 4) continue;
      const fw = fitWeights(train, opt);
      const fb = fitBlend(train, fw.weights, opt);
      const t = {weights: fw.weights, blend: fb.blend};
      test.forEach(one => {
        const b = loss([one], null, false);
        const u = loss([one], t, false);
        gains.push(b - u);
        base += b; tuned += u; n++;
      });
    }
    if(!n) return null;
    const gain = (base - tuned) / n;
    let v = 0;
    gains.forEach(g => { const d = g - gain; v += d * d; });
    const se = n > 1 ? Math.sqrt(v / (n - 1) / n) : Infinity;
    return {races: n, baseLoss: base / n, tunedLoss: tuned / n,
            gain: gain, se: se, t: se > 0 ? gain / se : 0};
  }

  /* ---------- 学習の本体 ---------- */
  function learn(records, opt){
    opt = opt || {};
    const ss = samples(records);
    if(ss.length < (opt.minRaces || MIN_RACES)){
      return {ok: false, reason: "few", races: ss.length,
              need: (opt.minRaces || MIN_RACES), tune: null,
              message: `着順まで入った記録が ${ss.length} レースです。` +
                       `${opt.minRaces || MIN_RACES} レース貯まると学習を始めます。`};
    }

    const cv = crossValidate(ss, opt);
    const fw = fitWeights(ss, opt);
    const fb = fitBlend(ss, fw.weights, opt);
    const tune = {
      version: VERSION,
      races: ss.length,
      weights: fw.weights,
      blend: fb.blend,
      fittedAt: opt.now || 0,
      check: cv
    };

    /* 検算で良くなっていないなら採用しない。
       「学習したのに当たらなくなった」を起こさないため。
       ばらつきの範囲内の改善（t が小さい）も、偶然として通さない。 */
    const solid = cv && cv.gain >= GAIN_MIN && cv.t >= T_MIN;
    if(!solid){
      return {ok: false, reason: "nogain", races: ss.length, tune: null, draft: tune, check: cv,
              message: cv
                ? `使っていないレースで確かめたところ、学習しても当てられ方が良くなるとは言えませんでした` +
                  `（${cv.baseLoss.toFixed(3)} → ${cv.tunedLoss.toFixed(3)}／` +
                  `偶然でないと言うには記録が足りません）。` +
                  `いまの見方のままにします。記録が増えるとまた試します。`
                : "検算できるだけの記録がありません。"};
    }

    return {ok: true, races: ss.length, tune: tune, check: cv,
            message: `${ss.length} レースから学習しました。` +
                     `使っていないレースで確かめて、当てられ方が良くなっています` +
                     `（${cv.baseLoss.toFixed(3)} → ${cv.tunedLoss.toFixed(3)}）。`};
  }

  /* ---------- 学んだ結果を言葉にする ---------- */
  function explain(tune){
    if(!tune || !tune.weights) return [];
    const out = [];
    KEYS.slice().sort((a, b) => Math.abs(tune.weights[b] - 1) - Math.abs(tune.weights[a] - 1))
        .forEach(k => {
          const v = tune.weights[k];
          if(Math.abs(v - 1) < 0.06) return;
          out.push({
            key: k, label: E.PART_LABEL[k] || k, mult: Math.round(v * 100) / 100,
            text: v > 1
              ? `${E.PART_LABEL[k]}は、これまでより重く見ます（×${v.toFixed(2)}）`
              : `${E.PART_LABEL[k]}は、これまでより軽く見ます（×${v.toFixed(2)}）`
          });
        });
    if(tune.blend != null){
      const d = tune.blend - E.BLEND_BASE;
      if(Math.abs(d) >= 0.03){
        out.push({
          key: "blend", label: "オッズとの混ぜ方",
          mult: Math.round(tune.blend * 100) / 100,
          text: d > 0
            ? `材料が揃ったレースでは、これまでより自分の見立てに寄せます（${E.BLEND_BASE.toFixed(2)} → ${tune.blend.toFixed(2)}）`
            : `オッズをこれまでより信じます（${E.BLEND_BASE.toFixed(2)} → ${tune.blend.toFixed(2)}）。` +
              `入力からの上積みが、まだはっきりしていないということです`
        });
      }
    }
    return out;
  }

  /* ---------- 較正 ----------
     「推定勝率20%と出した馬は、本当に20%勝っているか」を帯ごとに数える。
     出している数字が信用できるかどうかは、これでしか分からない。 */
  const BANDS = [[0,0.05],[0.05,0.10],[0.10,0.20],[0.20,0.35],[0.35,1.01]];

  function calibration(records, tune){
    const ss = samples(records);
    const rows = BANDS.map(b => ({from: b[0], to: b[1], n: 0, expect: 0, actual: 0}));
    ss.forEach(s => {
      const p = probsOf(s, tune).prob;
      p.forEach((v, i) => {
        const bi = BANDS.findIndex(b => v >= b[0] && v < b[1]);
        if(bi < 0) return;
        rows[bi].n++; rows[bi].expect += v;
        if(i === s.win) rows[bi].actual++;
      });
    });
    return rows.filter(r => r.n > 0).map(r => ({
      from: r.from, to: r.to, n: r.n,
      expect: r.expect / r.n,
      actual: r.actual / r.n
    }));
  }

  /* ---------- 市場に勝てているか ----------
     いちばん大事な検算。自分の1位指名が、1番人気より当たっているか。
     ここが負けているうちは、オッズどおりに買うほうが正しい。 */
  function versusMarket(records, tune){
    const ss = samples(records);
    if(!ss.length) return null;
    let ours = 0, fav = 0, ourLoss = 0, mktLoss = 0;
    ss.forEach(s => {
      const b = probsOf(s, tune);
      let oi = 0, fi = 0;
      b.prob.forEach((v, i) => { if(v > b.prob[oi]) oi = i; });
      s.market.forEach((v, i) => { if(v > s.market[fi]) fi = i; });
      if(oi === s.win) ours++;
      if(fi === s.win) fav++;
      ourLoss -= Math.log(Math.max(1e-12, b.prob[s.win]));
      mktLoss -= Math.log(Math.max(1e-12, s.market[s.win]));
    });
    const n = ss.length;
    return {races: n,
            ourWin: ours / n, favWin: fav / n,
            ourLoss: ourLoss / n, marketLoss: mktLoss / n,
            beatsMarket: ourLoss < mktLoss};
  }

  /* ---------- 1レースの振り返り ----------
     着順を入れた直後に出す。「なぜ外したか」を、その日の入力から言う。 */
  function review(record, tune){
    if(!record || !record.result || !(record.result.first > 0)) return null;
    const pred = record.pred || [];
    const winner = pred.find(p => p.num === record.result.first);
    if(!winner) return {lines: ["1着馬が予想に入っていません（取消・除外の扱いを確かめてください）。"]};

    const lines = [];
    lines.push(`1着 ${record.result.first}番 は、予想 ${winner.rank}位` +
               `（推定勝率 ${(winner.prob * 100).toFixed(1)}% ・ ${winner.odds}倍）でした。`);

    if(winner.rank === 1) lines.push("本命が勝ちました。いまの見方は、このレースでは合っていました。");
    else if(winner.rank <= 3) lines.push("上位に入れてはいました。決め手が足りなかった形です。");

    if(typeof winner.edge === "number"){
      if(winner.edge >= 1.10) lines.push("市場より高く見ていた馬が勝ちました。見立てのほうが正しかった一例です。");
      else if(winner.edge <= 0.90) lines.push("市場より低く見ていた馬が勝ちました。この馬を下げた項目を見直す材料になります。");
    }

    /* どの項目でこの馬を下げていたか。出走馬の平均との差で見る。 */
    if(winner.parts && pred.every(p => p.parts)){
      const diffs = [];
      E.PART_KEYS.forEach(k => {
        const vals = pred.map(p => (p.parts[k] != null ? p.parts[k] : 0));
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const d = (winner.parts[k] != null ? winner.parts[k] : 0) - avg;
        if(Math.abs(d) >= 0.8) diffs.push({key: k, label: E.PART_LABEL[k] || k, d: d});
      });
      diffs.sort((a, b) => a.d - b.d);
      const worst = diffs[0];
      if(worst && worst.d < 0 && winner.rank > 1){
        lines.push(`この馬をいちばん下げていたのは「${worst.label}」でした` +
                   `（平均より ${worst.d.toFixed(1)}点）。`);
      }
    }
    return {lines: lines, winnerRank: winner.rank};
  }

  return {
    MIN_RACES, GOOD_RACES, LAMBDA, GAIN_MIN, T_MIN, VERSION, KEYS,
    BLEND_GATE, BLEND_K,
    samples, probsOf, loss, fitWeights, fitBlend, crossValidate,
    learn, explain, calibration, versusMarket, review
  };
});
