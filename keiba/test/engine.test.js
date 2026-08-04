/* 予想エンジンの検証。node keiba/test/engine.test.js で実行する。 */
"use strict";
const assert = require("assert");
const E = require("../engine.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

function horse(num, over){
  return Object.assign(E.defaultHorse(num), over || {});
}
function field(n, over){
  const hs = [];
  for(let i=1;i<=n;i++) hs.push(horse(i, over));
  return hs;
}
const race = (over) => Object.assign(
  {track:"tokyo", surface:"turf", distance:1800, condition:0, pace:"mid", budget:5000}, over || {});

console.log("\n■ 競馬場データ");

t("中央10場・南関4場・その他地方が揃っている", () => {
  assert.strictEqual(E.JRA_KEYS.length, 10, "中央は10場のはず: " + E.JRA_KEYS.length);
  assert.strictEqual(E.NANKAN_KEYS.length, 4, "南関は4場のはず: " + E.NANKAN_KEYS.length);
  ["ooi","kawasaki","funabashi","urawa"].forEach(k =>
    assert.ok(E.NANKAN_KEYS.indexOf(k) >= 0, k + " がない"));
  ["monbetsu","morioka","mizusawa","kanazawa","kasamatsu",
   "nagoya","sonoda","himeji","kochi","saga"].forEach(k =>
    assert.ok(E.CHIHO_KEYS.indexOf(k) >= 0, k + " がない"));
  assert.strictEqual(E.NAR_KEYS.length, E.NANKAN_KEYS.length + E.CHIHO_KEYS.length,
    "地方の合計が合わない");
  E.TRACK_KEYS.forEach(k => assert.ok(E.TRACKS[k].area, k + " に area がない"));
});

t("南関はダートのみ・芝を指定してもダート値で扱う", () => {
  E.NANKAN_KEYS.forEach(k => {
    assert.strictEqual(E.TRACKS[k].straight.turf, undefined, k + " に芝がある");
    const s = E.straightOf({track:k, surface:"turf"});
    assert.strictEqual(s, E.TRACKS[k].straight.dirt, k + " の芝フォールバックが違う");
  });
});

t("外回り指定で直線が伸びる（新潟芝）", () => {
  const inner = E.straightOf({track:"niigata", surface:"turf"});
  const outer = E.straightOf({track:"niigata", surface:"turf", course:"outer"});
  assert.ok(outer > inner + 200, `外回りが伸びていない ${inner} → ${outer}`);
});

t("未知の競馬場でも例外にならず基準値になる", () => {
  assert.strictEqual(E.straightOf({track:"nowhere", surface:"turf"}), 350);
  assert.strictEqual(E.straightOf({}), 350);
});

console.log("\n■ 脚質補正（コース形態）");

t("直線の長い東京は差しが、短い浦和は逃げが有利になる", () => {
  const p = "mid";
  const tokyoSashi = E.styleBonus({track:"tokyo", surface:"turf", pace:p}, "sashi");
  const urawaSashi = E.styleBonus({track:"urawa", surface:"dirt", pace:p}, "sashi");
  const tokyoNige  = E.styleBonus({track:"tokyo", surface:"turf", pace:p}, "nige");
  const urawaNige  = E.styleBonus({track:"urawa", surface:"dirt", pace:p}, "nige");
  assert.ok(tokyoSashi > urawaSashi, `差し: 東京 ${tokyoSashi} > 浦和 ${urawaSashi} のはず`);
  assert.ok(urawaNige  > tokyoNige,  `逃げ: 浦和 ${urawaNige} > 東京 ${tokyoNige} のはず`);
});

t("南関4場はいずれも逃げ>追込（小回りダート）", () => {
  E.NAR_KEYS.forEach(k => {
    const r = {track:k, surface:"dirt", pace:"mid"};
    const nige = E.styleBonus(r, "nige");
    const oi   = E.styleBonus(r, "oikomi");
    assert.ok(nige > oi, `${E.TRACKS[k].name}: 逃げ ${nige.toFixed(2)} > 追込 ${oi.toFixed(2)} のはず`);
  });
});

t("ハイペースなら同じコースでも差しが逃げを上回る", () => {
  const r = k => ({track:"ooi", surface:"dirt", pace:k});
  assert.ok(E.styleBonus(r("high"), "sashi") > E.styleBonus(r("high"), "nige"),
    "大井でもハイペースなら差し有利になるはず");
  assert.ok(E.styleBonus(r("slow"), "nige") > E.styleBonus(r("slow"), "sashi"),
    "スローなら逃げ有利のはず");
});

console.log("\n■ 枠順補正");

t("小回りの浦和は東京より内枠有利が強い", () => {
  const n = 12;
  const inner = h => E.wakuBonus(h.r, {num:1}, n) - E.wakuBonus(h.r, {num:12}, n);
  const urawa = inner({r:{track:"urawa", surface:"dirt", distance:1400}});
  const tokyo = inner({r:{track:"tokyo", surface:"turf", distance:1800}});
  assert.ok(urawa > tokyo, `浦和の内外差 ${urawa.toFixed(2)} > 東京 ${tokyo.toFixed(2)} のはず`);
});

t("枠順補正は全体でおおむね釣り合う（極端な偏りがない）", () => {
  const n = 16;
  E.TRACK_KEYS.forEach(k => {
    const r = {track:k, surface:E.TRACKS[k].org==="nar"?"dirt":"turf", distance:1800};
    let sum = 0;
    for(let i=1;i<=n;i++) sum += E.wakuBonus(r, {num:i}, n);
    assert.ok(Math.abs(sum) < 1e-9, `${E.TRACKS[k].name} の枠順補正合計が ${sum}`);
  });
});


t("盛岡には芝があり、他の地方はダートのみ", () => {
  assert.strictEqual(E.straightOf({track:"morioka", surface:"turf"}), 300);
  E.CHIHO_KEYS.filter(k => k !== "morioka").forEach(k =>
    assert.strictEqual(E.TRACKS[k].straight.turf, undefined, k + " に芝がある"));
});

t("地方の小回りコースほど内枠有利が強い（高知 > 門別）", () => {
  const inner = track => {
    const r = {track: track, surface:"dirt", distance:1200};
    return E.wakuBonus(r, {num:1}, 10) - E.wakuBonus(r, {num:10}, 10);
  };
  assert.ok(inner("kochi") > inner("monbetsu"),
    `高知 ${inner("kochi").toFixed(2)} > 門別 ${inner("monbetsu").toFixed(2)} のはず`);
});

console.log("\n■ 温度の較正と妙味判定");

t("モデル勝率の広がりが市場と釣り合う（極端な人気薄を持ち上げない）", () => {
  // 実際の門別6R（2026/08/04）のデータ。317.4倍の馬がいる。
  const real = [
    {num:1, odds:2.2,   last1:2, last2:3, last3:10, kinryo:55, style:"sashi"},
    {num:2, odds:43.4,  last1:7, last2:4, last3:7,  kinryo:52, style:"sashi"},
    {num:3, odds:6.6,   last1:4, last2:2, last3:9,  kinryo:54, style:"sashi"},
    {num:4, odds:317.4, last1:6, last2:5, last3:5,  kinryo:57, style:"sashi"},
    {num:5, odds:63.0,  last1:4, last2:6, last3:6,  kinryo:55, style:"sashi"},
    {num:6, odds:2.4,   last1:2, last2:9, last3:2,  kinryo:57, style:"sashi"},
    {num:7, odds:5.0,   last1:4, last2:2, last3:3,  kinryo:55, style:"senko"}
  ].map(h => horse(h.num, h));
  const rows = E.analyze(race({track:"monbetsu", surface:"dirt", distance:1200}), real);

  const longshot = rows.find(x => x.h.odds === 317.4);
  assert.ok(!E.isValue(longshot),
    `317倍の馬に妙味が付いている（市場比 ${longshot.edge.toFixed(2)} / 勝率 ${(longshot.prob*100).toFixed(2)}%）`);

  // モデルの対数勝率の広がりが、市場の広がりから大きく外れないこと
  const std = a => { const m = a.reduce((x,y)=>x+y,0)/a.length;
                     return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length); };
  const sm = std(rows.map(x => Math.log(x.market)));
  const sd = std(rows.map(x => Math.log(x.model)));
  assert.ok(sd > sm * 0.5 && sd < sm * 2.0,
    `モデルの広がり ${sd.toFixed(2)} が市場 ${sm.toFixed(2)} と釣り合っていない`);
});

t("比率が大きくても勝率の絶対差が小さければ妙味にしない", () => {
  assert.ok(!E.isValue({edge: 2.0, prob: 0.004, market: 0.002}),
    "0.2%→0.4% を妙味と判定している");
  assert.ok(E.isValue({edge: 1.5, prob: 0.18, market: 0.12}),
    "12%→18% を妙味と判定していない");
});

t("過剰人気も同じ基準で判定する", () => {
  assert.ok(!E.isOverbet({edge: 0.5, prob: 0.002, market: 0.004}), "極小の差で過剰人気にしている");
  assert.ok(E.isOverbet({edge: 0.7, prob: 0.14, market: 0.20}), "20%→14% を過剰人気にしていない");
});

console.log("\n■ 勝率と期待値");

t("推定勝率の合計は1になる", () => {
  [3, 8, 18].forEach(n => {
    const hs = field(n).map((h,i) => Object.assign(h, {odds: 2 + i * 3}));
    const rows = E.analyze(race(), hs);
    const sum = rows.reduce((a,x)=>a+x.prob, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${n}頭の合計が ${sum}`);
  });
});

// 同オッズ・同能力でも枠順補正の分だけ差が出るのが正しい挙動なので、
// 「ほぼ均等」かつ「内枠ほど高い」ことを確認する。
t("同条件・同オッズなら勝率はほぼ均等で、内枠がわずかに上位", () => {
  const hs = field(10, {odds:10});
  const rows = E.analyze(race({track:"ooi", surface:"dirt"}), hs);
  rows.forEach(x => assert.ok(Math.abs(x.prob - 0.1) < 0.005,
    `均等から離れすぎ: ${x.prob}`));
  const byNum = hs.map(h => rows.find(x => x.h.num === h.num).prob);
  for(let i=1;i<byNum.length;i++)
    assert.ok(byNum[i] <= byNum[i-1] + 1e-12,
      `馬番 ${i+1} が ${i} より高い（内枠有利のはず）`);
});

t("市場比は市場と一致すればほぼ1.00になる", () => {
  const hs = field(8, {odds:8});
  const rows = E.analyze(race(), hs);
  rows.forEach(x => assert.ok(Math.abs(x.edge - 1) < 0.05, `edge=${x.edge}`));
});

t("能力が同じならオッズが低い馬ほど勝率が高い", () => {
  const hs = [horse(1,{odds:2}), horse(2,{odds:10}), horse(3,{odds:50})];
  const rows = E.analyze(race(), hs);
  assert.strictEqual(rows[0].h.num, 1);
  assert.strictEqual(rows[2].h.num, 3);
});

t("同オッズなら近走成績の良い馬が上位になる", () => {
  const hs = [horse(1,{odds:10,last1:8,last2:9,last3:10}),
              horse(2,{odds:10,last1:1,last2:1,last3:2})];
  const rows = E.analyze(race(), hs);
  assert.strictEqual(rows[0].h.num, 2, "近走の良い2番が上位のはず");
  assert.ok(rows[0].edge > 1, "市場より高く評価されるはず");
});

t("人気薄でも能力が高ければ妙味として検出される", () => {
  const hs = [horse(1,{odds:1.5,last1:9,last2:9,last3:9,jockey:1,training:1}),
              horse(2,{odds:20, last1:1,last2:1,last3:1,jockey:5,training:5}),
              horse(3,{odds:8}), horse(4,{odds:12}), horse(5,{odds:30})];
  const rows = E.analyze(race(), hs);
  const h2 = rows.find(x => x.h.num === 2);
  assert.ok(h2.edge > 1.15, `2番の市場比が ${h2.edge.toFixed(2)}（1.15超のはず）`);
});

t("オッズ1.0未満でも0除算にならない", () => {
  const hs = [horse(1,{odds:0}), horse(2,{odds:-5}), horse(3,{odds:10})];
  const rows = E.analyze(race(), hs);
  rows.forEach(x => assert.ok(isFinite(x.prob) && x.prob > 0, "確率が不正: " + x.prob));
});

console.log("\n■ 情報量による市場信頼度の調整");

t("入力が既定値だけなら市場そのものになり、妙味を出さない", () => {
  // 出馬表から取れるのは馬番・馬名・オッズ・斤量・馬体重まで。
  // 判断材料がない状態で人気薄を持ち上げてはいけない。
  const hs = [horse(1,{odds:2.4}), horse(2,{odds:15.7}), horse(3,{odds:6.3}),
              horse(4,{odds:52.3}), horse(5,{odds:9.9}), horse(6,{odds:3.8}),
              horse(7,{odds:22.1}), horse(8,{odds:7.7})];
  const rows = E.analyze(race({track:"ooi", surface:"dirt"}), hs);
  assert.ok(rows.infoLevel < 0.05, "情報量が高く出ている: " + rows.infoLevel);
  assert.ok(rows.marketWeight > 0.97, "市場の重みが足りない: " + rows.marketWeight);
  rows.forEach(x => assert.ok(Math.abs(x.edge - 1) < 0.05,
    `${x.h.num}番の市場比が ${x.edge.toFixed(2)}（材料がないので1.00付近のはず）`));
  const {value} = E.buildBets(rows, 5000);
  assert.strictEqual(value, undefined, "根拠のない妙味馬が出ている: " + (value && value.h.num));
});

t("材料が揃えばモデルの評価が反映される", () => {
  const hs = [horse(1,{odds:1.5,last1:9,last2:9,last3:9,jockey:1,training:1,style:"oikomi"}),
              horse(2,{odds:20, last1:1,last2:1,last3:1,jockey:5,training:5,style:"nige"}),
              horse(3,{odds:8,  last1:4,last2:3,last3:5,style:"senko"}),
              horse(4,{odds:12, last1:6,last2:2,last3:7,style:"sashi"}),
              horse(5,{odds:30, last1:7,last2:8,last3:6,style:"oikomi"})];
  const rows = E.analyze(race(), hs);
  assert.ok(rows.infoLevel > 0.8, "情報量が低く出ている: " + rows.infoLevel);
  assert.ok(rows.marketWeight < 0.66, "市場に寄りすぎ: " + rows.marketWeight);
  const h2 = rows.find(x => x.h.num === 2);
  assert.ok(h2.edge > 1.15, "2番の市場比が " + h2.edge.toFixed(2));
});

t("情報量が増えるほど市場比の振れ幅が大きくなる", () => {
  const base = i => ({odds: [2.4,15.7,6.3,52.3,9.9,3.8][i]});
  const bare = [0,1,2,3,4,5].map(i => horse(i+1, base(i)));
  const full = [0,1,2,3,4,5].map(i => horse(i+1, Object.assign(base(i), {
    last1:(i%6)+1, last2:((i+2)%6)+1, last3:((i+4)%6)+1,
    jockey:(i%5)+1, training:((i+2)%5)+1,
    style:["nige","senko","sashi","oikomi","senko","sashi"][i]})));
  const r = race({track:"kawasaki", surface:"dirt"});
  const spread = rows => Math.max.apply(null, rows.map(x=>x.edge)) -
                         Math.min.apply(null, rows.map(x=>x.edge));
  assert.ok(spread(E.analyze(r, full)) > spread(E.analyze(r, bare)) + 0.2,
    "情報量を増やしても市場比が動いていない");
});

console.log("\n■ 買い目");

t("どの予算でも超過しない（少額なら券種を減らす）", () => {
  [100, 300, 600, 1000, 2000, 5000, 30000].forEach(budget => {
    const hs = field(10).map((h,i)=>Object.assign(h,{odds:2+i*4}));
    const rows = E.analyze(race(), hs);
    const {bets} = E.buildBets(rows, budget);
    const spent = bets.reduce((s,x)=>s+x.total, 0);
    assert.ok(spent <= budget, `予算 ${budget} に対し ${spent} を使用`);
    assert.ok(bets.length >= 1, `予算 ${budget} で買い目が空`);
    bets.forEach(x => assert.ok(x.unit % 100 === 0 && x.unit >= 100,
      `${x.name} の1点単価が ${x.unit}`));
  });
});

t("予算を削っても単勝は最後まで残る", () => {
  const hs = field(10).map((h,i)=>Object.assign(h,{odds:2+i*4}));
  const rows = E.analyze(race(), hs);
  const {bets, dropped} = E.buildBets(rows, 200);
  assert.ok(bets.some(b => b.name === "単勝"), "単勝が残っていない");
  assert.ok(dropped.length > 0, "削られた券種が記録されていない");
});

t("3頭立てでも破綻せず、三連複は出さない", () => {
  const hs = [horse(1,{odds:2}), horse(2,{odds:4}), horse(3,{odds:8})];
  const rows = E.analyze(race(), hs);
  const {bets} = E.buildBets(rows, 5000);
  assert.ok(bets.length > 0, "買い目が空");
  assert.ok(!bets.some(b => b.name.indexOf("三連複") >= 0), "3頭で三連複が出ている");
});

t("買い目の馬番はすべて出走馬に含まれる", () => {
  const hs = field(12).map((h,i)=>Object.assign(h,{odds:2+i*3, last1:(i%8)+1}));
  const rows = E.analyze(race({track:"kawasaki", surface:"dirt"}), hs);
  const {bets} = E.buildBets(rows, 10000);
  const valid = new Set(hs.map(h=>String(h.num)));
  bets.forEach(b => b.combos.forEach(c =>
    c.split("-").forEach(x => assert.ok(valid.has(x), `不正な馬番 ${x} in ${c}`))));
});

console.log("\n■ ペース自動判定");

t("逃げ馬が多いとハイ、いないとスローになる", () => {
  assert.strictEqual(E.autoPace(field(6,{style:"nige"})).pace, "high");
  assert.strictEqual(E.autoPace(field(6,{style:"oikomi"})).pace, "slow");
  assert.strictEqual(E.autoPace([horse(1,{style:"nige"}),horse(2,{style:"senko"}),
                                 horse(3,{style:"sashi"})]).pace, "mid");
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
