/* 記録からの学習の検証。node keiba/test/learn.test.js で実行する。 */
"use strict";
const assert = require("assert");
const E = require("../engine.js");
const H = require("../history.js");
const L = require("../learn.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

/* ---------- 検証用のレースを作る ----------
   「真の強さ」を engine の項目の重み付き和で作り、その重みを既定とは
   わざと違えておく。学習がその向きへ動くかどうかで良し悪しを判断する。 */
function rng(seed){
  let s = seed >>> 0;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return s/4294967296; };
}
const gauss = R => Math.sqrt(-2*Math.log(R() || 1e-9)) * Math.cos(2*Math.PI*R());

const TRUE_W = {form:1.6, jockey:1.8, training:0.5, dist:1.2, baba:0.9,
                pace:0.7, kinryo:0.6, weight:0.4, waku:1.3};
const STYLES = ["nige","senko","sashi","oikomi"];

function makeRecords(n, seed, noise, mktNoise){
  const R = rng(seed), recs = [];
  const mn = mktNoise == null ? 0.30 : mktNoise;
  for(let g = 0; g < n; g++){
    const nh = 8 + Math.floor(R() * 8);
    const race = {track:"ooi", surface:"dirt", distance:1600,
                  condition: R() < 0.7 ? 0 : 1 + Math.floor(R()*3),
                  pace:"mid", budget:5000};
    const hs = [];
    for(let i = 1; i <= nh; i++){
      hs.push({num:i, name:"馬"+i, odds:10, jockeyName:"騎"+(1+Math.floor(R()*10)),
        last1:1+Math.floor(R()*9), last2:1+Math.floor(R()*9), last3:1+Math.floor(R()*9),
        jockey:1+Math.floor(R()*5), training:1+Math.floor(R()*5),
        dist:Math.floor(R()*4), baba:Math.floor(R()*4),
        kinryo:53+Math.round(R()*5), wdiff:Math.round(gauss(R)*7),
        style:STYLES[Math.floor(R()*4)], scratched:false});
    }
    race.pace = E.autoPace(hs).pace;

    const base = E.analyze(race, hs);
    const byNum = {}; base.forEach(x => { byNum[x.h.num] = x; });
    const strength = hs.map(h => {
      const p = byNum[h.num].parts;
      let s = 0;
      E.PART_KEYS.forEach(k => { s += (p[k] || 0) * TRUE_W[k]; });
      return Math.exp(s / 9 + gauss(R) * noise);
    });
    const sSum = strength.reduce((a,b)=>a+b, 0);
    const pTrue = strength.map(v => v / sSum);
    const mk = pTrue.map(p => Math.pow(p, 0.90) * Math.exp(gauss(R) * mn));
    const mSum = mk.reduce((a,b)=>a+b, 0);
    hs.forEach((h, i) => { h.odds = Math.max(1.1, Math.round(0.8 / (mk[i]/mSum) * 10) / 10); });

    const rows = E.analyze(race, hs);
    const idx = hs.map((_, i) => i), order = [];
    for(let k = 0; k < 3 && idx.length; k++){
      let s = 0; idx.forEach(i => { s += pTrue[i]; });
      let x = R() * s, pick = idx.length - 1;
      for(let i = 0; i < idx.length; i++){ x -= pTrue[idx[i]]; if(x <= 0){ pick = i; break; } }
      order.push(idx[pick]); idx.splice(pick, 1);
    }
    const rec = H.makeRecord(race, rows, [], 1700000000000 + g * 1000, null, rows.upset);
    rec.result = {first: hs[order[0]].num, second: hs[order[1]].num, third: hs[order[2]].num};
    recs.push(rec);
  }
  return recs;
}

console.log("\n■ 記録から学習に使える形へ");

const R120 = makeRecords(120, 424242, 0.55);

t("着順の入った記録だけを対象にする", () => {
  const some = R120.slice(0, 10).map(r => Object.assign({}, r));
  some[0] = Object.assign({}, some[0], {result: null});
  assert.strictEqual(L.samples(some).length, 9);
});

t("項目・市場勝率・情報量が揃っていない記録は使わない", () => {
  const r = JSON.parse(JSON.stringify(R120[0]));
  assert.strictEqual(L.samples([r]).length, 1, "揃っている記録が使えていない");

  const noParts = JSON.parse(JSON.stringify(r));
  noParts.pred[2].parts = null;
  assert.strictEqual(L.samples([noParts]).length, 0, "項目が欠けた記録を使っている");

  const noInfo = JSON.parse(JSON.stringify(r));
  noInfo.infoLevel = null;
  assert.strictEqual(L.samples([noInfo]).length, 0, "情報量の無い記録を使っている");

  const noMarket = JSON.parse(JSON.stringify(r));
  noMarket.pred[0].market = 0;
  assert.strictEqual(L.samples([noMarket]).length, 0, "市場勝率の無い記録を使っている");
});

t("更新前（項目を持たない）の記録が混ざっても落ちない", () => {
  const old = {id:"old1", savedAt: 1, race:{}, pred:[
    {rank:1, num:1, odds:2.0, prob:0.5}, {rank:2, num:2, odds:3.0, prob:0.5}
  ], bets:[], result:{first:1}};
  const mixed = H.normalize([old].concat(R120.slice(0, 5)));
  assert.strictEqual(L.samples(mixed).length, 5);
  assert.doesNotThrow(() => L.learn(mixed));
});

t("1着馬が予想に無い記録は使わない（取消のあとで着順を入れた場合）", () => {
  const r = JSON.parse(JSON.stringify(R120[0]));
  r.result = {first: 99};
  assert.strictEqual(L.samples([r]).length, 0);
});

console.log("\n■ 予想と学習が同じ計算を通っている");

t("学習側で出し直した勝率が、予想画面の勝率と一致する", () => {
  /* ここが崩れると、学習は「別の計算」を最適化してしまう。
     記録は小数を丸めて保存しているので、その分だけ差を許す。 */
  const race = {track:"nakayama", surface:"turf", distance:1800,
                condition:1, pace:"mid", budget:5000};
  const hs = [];
  for(let i = 1; i <= 12; i++){
    hs.push(Object.assign(E.defaultHorse(i), {
      odds: 2 + i * 3.1, last1:(i % 9) + 1, last2:((i*3) % 9) + 1, last3:((i*5) % 9) + 1,
      jockey:(i % 5) + 1, training:((i+2) % 5) + 1, dist:i % 4, baba:(i+1) % 4,
      kinryo: 54 + (i % 4), wdiff: (i % 7) - 3, style: STYLES[i % 4]}));
  }
  const rows = E.analyze(race, hs);
  const rec = H.makeRecord(race, rows, [], 1, null, rows.upset);
  rec.result = {first: rows[0].h.num};
  const s = L.samples([rec])[0];
  const got = L.probsOf(s).prob;
  rows.forEach((x, i) => {
    assert.ok(Math.abs(got[i] - x.prob) < 5e-3,
      `${i}番目: 予想 ${x.prob.toFixed(4)} / 学習側 ${got[i].toFixed(4)}`);
  });
});

t("重みを渡さなければ、これまでと同じ予想になる", () => {
  const race = {track:"tokyo", surface:"turf", distance:2000, condition:0, pace:"mid", budget:5000};
  const hs = [];
  for(let i = 1; i <= 10; i++) hs.push(Object.assign(E.defaultHorse(i), {odds: i * 2.5, last1: i}));
  const a = E.analyze(race, hs).map(x => x.prob);
  const b = E.analyze(race, hs, null).map(x => x.prob);
  const c = E.analyze(race, hs, {weights:{}}).map(x => x.prob);
  const d = E.analyze(race, hs, {weights:{form:1, jockey:1}, blend:E.BLEND_BASE}).map(x => x.prob);
  [b, c, d].forEach((arr, k) => arr.forEach((v, i) =>
    assert.ok(Math.abs(v - a[i]) < 1e-12, `${k}: ${i} で違う ${v} / ${a[i]}`)));
});

t("壊れた重みを渡しても、予想が壊れない", () => {
  const race = {track:"ooi", surface:"dirt", distance:1600, condition:0, pace:"mid", budget:5000};
  const hs = [];
  for(let i = 1; i <= 8; i++) hs.push(Object.assign(E.defaultHorse(i), {odds: i * 3}));
  [{weights:{form:NaN, jockey:-4, waku:"x"}},
   {weights:null, blend:NaN},
   {blend:99},
   {blend:-5}].forEach(bad => {
    const rows = E.analyze(race, hs, bad);
    assert.strictEqual(rows.length, 8);
    assert.ok(Math.abs(rows.reduce((a,x)=>a+x.prob, 0) - 1) < 1e-9, "確率の合計が1でない");
    assert.ok(rows.every(x => x.prob > 0 && isFinite(x.prob)), "確率が壊れている");
  });
});

console.log("\n■ 当てはめ");

t("倍率は平均1に揃い、可動域に収まる", () => {
  const f = L.fitWeights(L.samples(R120));
  const vals = L.KEYS.map(k => f.weights[k]);
  const mean = vals.reduce((a,b)=>a+b, 0) / vals.length;
  assert.ok(Math.abs(mean - 1) < 0.02, "平均が1でない: " + mean.toFixed(3));
  vals.forEach(v => assert.ok(v >= 0.4 - 1e-9 && v <= 2.2 + 1e-9, "可動域の外: " + v));
});

t("当てはめると、当てはめに使ったレースでの損失は必ず下がる", () => {
  const ss = L.samples(R120);
  const f = L.fitWeights(ss);
  assert.ok(L.loss(ss, {weights: f.weights}, true) <= L.loss(ss, null, true) + 1e-9,
    "モデル側の損失が下がっていない");
});

t("真の重みが大きい項目ほど、倍率も大きくなる", () => {
  const f = L.fitWeights(L.samples(makeRecords(300, 20260806, 0.45)));
  // 真の重みが最大の「騎手」が、最小の「馬体重増減」より重くなっていること
  assert.ok(f.weights.jockey > f.weights.weight,
    `騎手 ${f.weights.jockey.toFixed(2)} ≦ 馬体重増減 ${f.weights.weight.toFixed(2)}`);
  assert.ok(f.weights.form > f.weights.training,
    `近走 ${f.weights.form.toFixed(2)} ≦ 調教 ${f.weights.training.toFixed(2)}`);
});

t("記録が少ないうちは、混ぜ方を動かさない", () => {
  const few = L.samples(R120).slice(0, L.BLEND_GATE - 1);
  assert.strictEqual(L.fitBlend(few, null).blend, null, "少ないのに動かしている");
  const many = L.samples(makeRecords(200, 777, 0.5));
  const fb = L.fitBlend(many, null);
  assert.ok(typeof fb.blend === "number", "十分な記録でも動かしていない");
  // 引き戻しがあるので、当てはめた値より既定寄りになる
  assert.ok(Math.abs(fb.blend - E.BLEND_BASE) <= Math.abs(fb.raw - E.BLEND_BASE) + 1e-9,
    `引き戻しが効いていない: 素 ${fb.raw} → ${fb.blend}`);
});

console.log("\n■ 採用するかどうかの判断");

t("記録が20レース未満なら学習しない", () => {
  const out = L.learn(makeRecords(12, 5, 0.5));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "few");
  assert.strictEqual(out.tune, null);
  assert.ok(/20/.test(out.message), out.message);
});

t("改善がばらつきの範囲内なら採用しない（偶然を通さない）", () => {
  /* 着順を乱数で決めたレース。学べるものが何も無いので、
     当てはめは必ず「たまたま」に合わせに行く。ここで採用されては困る。 */
  const R = rng(999);
  const noise = makeRecords(80, 31337, 0.5).map(r => {
    const c = JSON.parse(JSON.stringify(r));
    c.result = {first: c.pred[Math.floor(R() * c.pred.length)].num};
    return c;
  });
  const out = L.learn(noise);
  assert.strictEqual(out.ok, false, "でたらめな着順から学習してしまった");
  assert.strictEqual(out.tune, null);
  assert.ok(out.draft, "見送った中身が残っていない");
});

t("学ぶものがあるときは採用し、検算の結果を残す", () => {
  // 市場が甘い（オッズの精度が低い）＝ 入力から上積みできる余地があるレース
  const out = L.learn(makeRecords(300, 20260806, 0.5, 0.9), {now: 1234});
  assert.strictEqual(out.ok, true, out.message);
  assert.ok(out.tune && out.tune.weights, "重みが無い");
  assert.strictEqual(out.tune.fittedAt, 1234);
  assert.ok(out.check.gain >= L.GAIN_MIN, "改善が足りないのに採用している");
  assert.ok(out.check.t >= L.T_MIN, "ばらつきの範囲内なのに採用している");
  assert.ok(out.check.tunedLoss < out.check.baseLoss, "検算で良くなっていない");
});

t("学習した重みを使うと、使っていないレースでも当てられ方が良くなる", () => {
  const all = makeRecords(400, 616161, 0.5, 0.9);
  const train = all.slice(0, 300), test = L.samples(all.slice(300));
  const out = L.learn(train);
  assert.ok(out.ok, "学習が採用されなかった: " + out.message);
  const before = L.loss(test, null, false);
  const after  = L.loss(test, out.tune, false);
  assert.ok(after < before, `学習後に悪化している: ${before.toFixed(4)} → ${after.toFixed(4)}`);
});

console.log("\n■ 振り返りの材料");

t("学んだ内容を言葉にできる", () => {
  const out = L.learn(makeRecords(300, 20260806, 0.5, 0.9));
  const lines = L.explain(out.tune);
  assert.ok(lines.length, "説明が出ていない");
  lines.forEach(x => {
    assert.ok(x.text && x.label, "説明の形が壊れている");
    assert.ok(/[×0-9]/.test(x.text), "数字が入っていない: " + x.text);
  });
  // 動きの大きい項目から並ぶ
  const moves = lines.filter(x => x.key !== "blend").map(x => Math.abs(x.mult - 1));
  for(let i = 1; i < moves.length; i++)
    assert.ok(moves[i-1] >= moves[i] - 1e-9, "動きの大きい順に並んでいない");
});

t("較正表が出る（出した勝率と実際の勝率）", () => {
  const rows = L.calibration(R120, null);
  assert.ok(rows.length >= 3, "帯が足りない: " + rows.length);
  rows.forEach(r => {
    assert.ok(r.n > 0);
    assert.ok(r.expect >= r.from - 1e-9 && r.expect <= r.to + 1e-9,
      `帯 ${r.from}〜${r.to} の平均が外れている: ${r.expect}`);
    assert.ok(r.actual >= 0 && r.actual <= 1);
  });
  // 帯が上がるほど、実際の勝率も上がる（大きく崩れていないことの確認）
  assert.ok(rows[rows.length-1].actual > rows[0].actual, "帯と実績が逆転している");
});

t("市場に勝てているかを出せる", () => {
  const vm = L.versusMarket(R120, null);
  assert.strictEqual(vm.races, L.samples(R120).length);
  assert.ok(vm.ourWin >= 0 && vm.ourWin <= 1);
  assert.ok(vm.favWin >= 0 && vm.favWin <= 1);
  assert.strictEqual(vm.beatsMarket, vm.ourLoss < vm.marketLoss);
  assert.strictEqual(L.versusMarket([], null), null);
});

t("1レースの振り返りが出る", () => {
  const rec = R120.find(r => {
    const w = r.pred.find(p => p.num === r.result.first);
    return w && w.rank > 1;
  });
  const rv = L.review(rec, null);
  assert.ok(rv && rv.lines.length >= 2, "振り返りが出ていない");
  assert.ok(rv.lines[0].indexOf(String(rec.result.first)) >= 0, "1着馬に触れていない");
  assert.ok(rv.winnerRank > 1);
  assert.strictEqual(L.review({}, null), null);
  assert.strictEqual(L.review(null, null), null);
});

t("1着馬が予想に無いときも、振り返りで落ちない", () => {
  const rec = JSON.parse(JSON.stringify(R120[0]));
  rec.result = {first: 999};
  const rv = L.review(rec, null);
  assert.ok(rv && rv.lines.length === 1, "案内が出ていない");
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
