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

t("判定は市場比ではなく期待値で行う", () => {
  /* 市場比 1.20 倍は、控除率を戻すと期待値ちょうど1.0前後でしかない。
     「やっと元が取れる」水準を妙味と呼ぶと、買うほど負ける。 */
  assert.ok(!E.isValue({ev: 1.00, prob: 0.18, market: 0.15}),
    "期待値1.00を妙味にしている");
  assert.ok(E.isValue({ev: 1.35, prob: 0.18, market: 0.12}),
    "期待値1.35を妙味にしていない");
});

t("比率が大きくても勝率の絶対差が小さければ妙味にしない", () => {
  assert.ok(!E.isValue({ev: 2.0, prob: 0.004, market: 0.002}),
    "0.2%→0.4% を妙味と判定している");
});

t("過剰人気も同じ基準で判定する", () => {
  assert.ok(!E.isOverbet({ev: 0.5, prob: 0.002, market: 0.004}), "極小の差で過剰人気にしている");
  assert.ok(E.isOverbet({ev: 0.65, prob: 0.14, market: 0.20}), "期待値0.65を過剰人気にしていない");
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
  const {value, bets, grade} = E.buildBets(rows, 5000);
  assert.ok(!value, "根拠のない妙味馬が出ている: " + (value && value.h.num));
  // さらに、材料がない状態ではそもそも買わない
  assert.strictEqual(grade.grade, "skip", "材料なしで買おうとしている");
  assert.strictEqual(bets.length, 0, "材料なしで買い目を出している");
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

/* 買える状態のレース。近走・脚質・騎手が入っていて、
   モデルの評価が市場と食い違うため期待値プラスの馬が生まれる。 */
function lively(n){
  const hs = [];
  for(let i=0;i<n;i++) hs.push(horse(i+1, {
    odds: 2 + i*4,
    last1:((i*3)%8)+1, last2:((i*5)%8)+1, last3:((i*7)%8)+1,
    jockey:(i%5)+1, training:((i+2)%5)+1,
    style:["nige","senko","sashi","oikomi"][i%4]
  }));
  return hs;
}

t("どの予算でも超過しない（少額なら券種を減らす）", () => {
  [100, 300, 600, 1000, 2000, 5000, 30000].forEach(budget => {
    const rows = E.analyze(race(), lively(10));
    const {bets, spend} = E.buildBets(rows, budget);
    const spent = bets.reduce((s,x)=>s+x.total, 0);
    assert.ok(spent <= budget, `予算 ${budget} に対し ${spent} を使用`);
    assert.ok(spent <= spend, `投入予定 ${spend} を超えて ${spent} を使用`);
    assert.ok(bets.length >= 1, `予算 ${budget} で買い目が空`);
    bets.forEach(x => assert.ok(x.unit % 100 === 0 && x.unit >= 100,
      `${x.name} の1点単価が ${x.unit}`));
  });
});

t("予算を削っても単勝は最後まで残る", () => {
  const rows = E.analyze(race(), lively(10));
  const {bets, dropped} = E.buildBets(rows, 200);
  assert.ok(bets.some(b => b.name === "単勝"), "単勝が残っていない");
  assert.ok(dropped.length > 0, "削られた券種が記録されていない");
});

t("3頭立てでは発売されない券種を出さない", () => {
  // 複勝は4頭以下、ワイド・三連複は3頭以下では発売されない
  const rows = E.analyze(race(), lively(3));
  const {bets} = E.buildBets(rows, 5000);
  assert.ok(bets.length > 0, "買い目が空");
  ["三連複", "ワイド", "複勝"].forEach(k =>
    assert.ok(!bets.some(b => b.name.indexOf(k) >= 0), `3頭で${k}が出ている`));
});

t("買い目の馬番はすべて出走馬に含まれる", () => {
  const hs = lively(12);
  const rows = E.analyze(race({track:"kawasaki", surface:"dirt"}), hs);
  const {bets} = E.buildBets(rows, 10000);
  const valid = new Set(hs.map(h=>String(h.num)));
  assert.ok(bets.length > 0);
  bets.forEach(b => b.combos.forEach(c =>
    c.split("-").forEach(x => assert.ok(valid.has(x), `不正な馬番 ${x} in ${c}`))));
});

console.log("\n■ 買うべきレースの見極め");

t("材料が乏しければ買わない", () => {
  const rows = E.analyze(race(), field(10).map((h,i)=>Object.assign(h,{odds:2+i*4})));
  const {grade, bets} = E.buildBets(rows, 5000);
  assert.strictEqual(grade.grade, "skip", "情報量が低いのに買おうとしている");
  assert.strictEqual(bets.length, 0);
  assert.strictEqual(grade.stakeRatio, 0);
  assert.ok(/情報量/.test(grade.reason), "理由に情報量が出ていない: " + grade.reason);
});

t("期待値1.0を超える馬がいなければ買わない", () => {
  /* モデルが市場とほぼ一致するレース。控除率のぶん、
     どの馬を買っても期待値は1を割る。 */
  const hs = field(8).map((h,i) => Object.assign(h, {
    odds: [2,3,4,6,9,14,25,50][i],
    last1: i+1, last2: i+1, last3: i+1,          // 人気順どおりの成績
    jockey: Math.max(1, 5-i), training: Math.max(1, 5-i),
    style: ["nige","senko","sashi","oikomi"][i%4]
  }));
  const rows = E.analyze(race(), hs);
  const {grade, bets} = E.buildBets(rows, 5000);
  assert.ok(rows.infoLevel >= 0.35, "情報量の方で弾かれている: " + rows.infoLevel);
  assert.ok(rows.every(x => x.ev < 1.0 || x.prob < 0.04),
    "期待値プラスの馬がいる: " + rows.map(x=>x.ev.toFixed(2)).join(","));
  assert.strictEqual(grade.grade, "skip");
  assert.strictEqual(bets.length, 0, "見送りなのに買い目が出ている");
});

t("期待値の大きさと荒れ度で投入額を変える", () => {
  const rows = E.analyze(race(), lively(10));
  const {grade, upset, spend} = E.buildBets(rows, 10000);
  assert.ok(["small","normal","strong"].indexOf(grade.grade) >= 0, grade.grade);
  assert.strictEqual(spend,
    Math.floor(10000 * grade.stakeRatio * upset.stakeScale / 100) * 100);
  assert.ok(grade.stakeRatio <= 1 && grade.stakeRatio > 0);
  assert.ok(upset.stakeScale <= 1 && upset.stakeScale > 0);
});

t("単勝は期待値が1.0以上の馬にしか買わない", () => {
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  const byNum = {};
  rows.forEach(x => { byNum[x.h.num] = x; });
  bets.filter(b => b.name.indexOf("単勝") === 0).forEach(b => {
    const x = byNum[Number(b.combos[0])];
    assert.ok(x.ev >= 1.0, `${x.h.num}番の期待値 ${x.ev.toFixed(2)} で単勝を買っている`);
    assert.ok(Math.abs(b.evKnown - x.ev) < 1e-9, "単勝に期待値が付いていない");
  });
});

t("軸を1頭に固定しない（同じ馬が全点に入らない）", () => {
  /* 軸を固定すると、その馬を含まない組み合わせはどれだけ割が良くても
     買えなくなる。とくに人気を被った本命は軸から外れやすいが、
     本命は最も勝つ回数が多い馬でもある。 */
  const rows = E.analyze(race({condition:2}), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  const umaren = bets.find(b => b.name === "馬連");
  assert.ok(umaren, "馬連が無い: " + bets.map(b => b.name).join(","));
  if(umaren.combos.length < 2) return;
  const counts = {};
  umaren.combos.forEach(c => c.split("-").forEach(x => { counts[x] = (counts[x]||0)+1; }));
  const everywhere = Object.keys(counts).filter(k => counts[k] === umaren.combos.length);
  assert.ok(everywhere.length <= 1,
    "同じ馬が全点に入っている（軸固定になっている）: " + everywhere.join(","));
});

t("割が良ければ、期待値の低い本命を含む組み合わせも買う", () => {
  /* 本命は期待値が1を割っていても、相手の割が良ければ組み合わせは
     プラスになりうる。しかも的中率がいちばん高い。 */
  const rows = E.analyze(race({condition:2}), lively(12));
  const fav = rows.slice().sort((x, y) => x.h.odds - y.h.odds)[0];
  const {bets} = E.buildBets(rows, 20000, {policy:"value"});
  const all = [];
  bets.filter(b => b.evKnown == null).forEach(b => b.points.forEach(pt => all.push(pt)));
  // 本命を含む点があるなら、それは推定期待値が1以上であること
  all.filter(pt => pt.combo.split("-").indexOf(String(fav.h.num)) >= 0)
     .forEach(pt => assert.ok(pt.ev >= 1.0,
       `本命入りの ${pt.combo} が期待値 ${pt.ev.toFixed(2)} で入っている`));
});

console.log("\n■ 的中確率と必要オッズ");

t("複勝率・連対率は勝率以上で、1を超えない", () => {
  const rows = E.analyze(race(), lively(12));
  const p = rows.map(x => x.prob);
  p.forEach((_, i) => {
    const t1 = E.topKProb(p, i, 1), t2 = E.topKProb(p, i, 2), t3 = E.topKProb(p, i, 3);
    assert.ok(Math.abs(t1 - p[i]) < 1e-12, "1着以内が勝率と違う");
    assert.ok(t2 >= t1 - 1e-12 && t3 >= t2 - 1e-12, `単調でない: ${t1} ${t2} ${t3}`);
    assert.ok(t3 <= 1 + 1e-9, "確率が1を超えた: " + t3);
  });
  // 全馬の「k着以内」の合計は k になる
  [1,2,3].forEach(k => {
    const sum = p.map((_, i) => E.topKProb(p, i, k)).reduce((a,b)=>a+b, 0);
    assert.ok(Math.abs(sum - k) < 1e-6, `${k}着以内の合計が ${sum.toFixed(4)}（${k} のはず）`);
  });
});

t("馬連・ワイド・三連複の的中確率が整合する", () => {
  const rows = E.analyze(race(), lively(8));
  const p = rows.map(x => x.prob);
  // 全ペアの馬連確率の合計は1（1・2着の組は必ずどれか1つ）
  let q = 0;
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) q += E.quinellaProb(p, i, j);
  assert.ok(Math.abs(q - 1) < 1e-6, "馬連の合計が " + q.toFixed(4));
  // 全3頭組の三連複確率の合計も1
  let tr = 0;
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) for(let k=j+1;k<p.length;k++)
    tr += E.trioProb(p, i, j, k);
  assert.ok(Math.abs(tr - 1) < 1e-6, "三連複の合計が " + tr.toFixed(4));
  // ワイドは馬連より当たりやすい
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++)
    assert.ok(E.wideProb(p,i,j) >= E.quinellaProb(p,i,j) - 1e-12,
      `ワイドが馬連を下回った ${i},${j}`);
});

t("オッズが分からない券種には必要オッズを付ける", () => {
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  bets.forEach(b => {
    assert.ok(b.hit > 0 && b.hit <= 1, `${b.name} の的中確率が ${b.hit}`);
    if(b.evKnown == null){
      // n点を同額で買うときの損益分岐は「点数 ÷ 的中確率」
      assert.ok(Math.abs(b.needOdds - b.combos.length / b.hit) < 1e-9,
        `${b.name} の必要オッズが合わない`);
      assert.ok(b.needOdds > 1, `${b.name} の必要オッズが ${b.needOdds}`);
    }
  });
  assert.ok(bets.some(b => b.evKnown != null), "期待値が計算できる券種が無い");
  assert.ok(bets.some(b => b.evKnown == null), "必要オッズを出す券種が無い");
});

t("1点ごとの的中確率と必要オッズを出す", () => {
  /* 券種としての必要オッズは点数の平均でしかない。どの1点を外すか決めるには
     1点ごとの数字が要る。同額で買う場合、1点の損益分岐は 1÷的中確率。 */
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  bets.forEach(b => {
    assert.ok(b.points, b.name + " に1点ごとの数字が無い");
    assert.strictEqual(b.points.length, b.combos.length, b.name + " の点数が合わない");
    b.points.forEach((pt, i) => {
      assert.strictEqual(pt.combo, b.combos[i]);
      assert.ok(pt.hit > 0 && pt.hit <= 1, `${b.name} ${pt.combo} の的中確率 ${pt.hit}`);
      assert.ok(Math.abs(pt.needOdds - 1 / pt.hit) < 1e-9, "1点の必要オッズが合わない");
    });
    // 1点ごとの的中確率の合計が、券種全体の的中確率になる
    const sum = b.points.reduce((s, p) => s + p.hit, 0);
    assert.ok(Math.abs(sum - b.hit) < 1e-9, `${b.name} の合計が ${sum} と ${b.hit} で合わない`);
    // 平均の必要オッズは 点数 ÷ 合計確率
    assert.ok(Math.abs(b.needOdds - b.combos.length / sum) < 1e-9 || b.evKnown != null,
      b.name + " の平均必要オッズが合わない");
  });
});

t("必要オッズは的中確率と1対1で対応する", () => {
  // 買い目は期待値順に並ぶので必要オッズの順は揃わないが、
  // 「当たりにくい点ほど必要オッズが高い」関係は常に成り立つ
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  bets.filter(b => b.evKnown == null).forEach(b => {
    const byHit = b.points.slice().sort((x, y) => y.hit - x.hit);
    for(let i = 1; i < byHit.length; i++){
      assert.ok(byHit[i].needOdds >= byHit[i-1].needOdds - 1e-9,
        `${b.name}: ${byHit[i-1].combo} → ${byHit[i].combo}`);
    }
  });
});

console.log("\n■ 連系の推定期待値（単勝オッズから組み立てる）");

t("市場と同じ見立てなら、推定期待値は控除率のぶんだけ1を割る", () => {
  // こちらの確率＝市場の確率 のとき、期待値は (1 − 控除率) になるはず
  Object.keys(E.TAKEOUT).forEach(k => {
    const ev = E.comboEv(0.05, 0.05, k);
    assert.ok(Math.abs(ev - (1 - E.TAKEOUT[k])) < 1e-12, `${k}: ${ev}`);
  });
});

t("市場より高く見ているほど推定期待値が上がる", () => {
  const a = E.comboEv(0.10, 0.05, "sanrentan");
  const b = E.comboEv(0.05, 0.05, "sanrentan");
  const c = E.comboEv(0.02, 0.05, "sanrentan");
  assert.ok(a > b && b > c, `${a} > ${b} > ${c}`);
  // 比をそのまま掛けるのではなく λ 乗して縮めるので、2倍にはならない
  assert.ok(a < 2 * b, "比をそのまま信じてしまっている（縮めていない）");
  assert.ok(Math.abs(b - (1 - E.TAKEOUT.sanrentan)) < 1e-12,
    "市場と同じ見立てなら、控除率のぶんちょうど負けるはず");
  assert.ok(E.RELIABILITY.tan === 1, "単勝は実測オッズなので縮めない");
  assert.ok(E.RELIABILITY.sanrentan < E.RELIABILITY.umaren,
    "着順まで当てる券種ほど強く縮めるはず");
});

t("推定期待値が同じなら、当たりやすいほうが資金は速く増える", () => {
  // 盛岡12Rで実際に起きていた取りこぼし。期待値では 3-11 が上だが、
  // 資金の増え方では 4-11 が上に来る（＝こちらを買う）。
  const a = E.growth(0.107, 1.53);
  const b = E.growth(0.021, 3.67);
  assert.ok(a > b, `4-11(${a.toFixed(4)}) が 3-11(${b.toFixed(4)}) より下`);
  assert.strictEqual(E.growth(0.1, 0.9), 0, "期待値1未満は増えないので0");
  assert.strictEqual(E.kellyFraction(0.1, 0.9), 0, "期待値1未満には賭けない");
  // 当たりにくい大穴は自動的に後ろへ下がる
  assert.ok(E.growth(0.0005, 3.0) < E.growth(0.107, 1.53) / 10, "大穴が沈んでいない");
});

t("三連単の控除率がいちばん高い", () => {
  assert.ok(E.TAKEOUT.sanrentan > E.TAKEOUT.sanrenpuku);
  assert.ok(E.TAKEOUT.sanrenpuku > E.TAKEOUT.umaren);
  assert.ok(E.TAKEOUT.umaren > E.TAKEOUT.tan);
});

t("市場の確率が0なら0を返す（0除算にしない）", () => {
  assert.strictEqual(E.comboEv(0.1, 0, "umaren"), 0);
});

t("回収率重視では、推定期待値が1を割る点を1つも買わない", () => {
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000, {policy:"value"});
  bets.forEach(b => {
    (b.points || []).forEach(pt => {
      if(pt.ev == null) return;
      assert.ok(pt.ev >= 1.0, `${b.name} ${pt.combo} の推定期待値が ${pt.ev.toFixed(2)}`);
    });
    assert.ok(!b.underEv, b.name + " が期待値1割れの印を持っている");
  });
});

t("期待値1割れの点を買う券種には、必ず印が付く", () => {
  ["value", "balance", "hit"].forEach(key => {
    const rows = E.analyze(race(), lively(12));
    const {bets} = E.buildBets(rows, 20000, {policy:key});
    bets.forEach(b => {
      const under = (b.points || []).some(pt => pt.ev != null && pt.ev < 1.0);
      assert.strictEqual(!!b.underEv, under,
        `${key}: ${b.name} の印（${b.underEv}）が中身（${under}）と合っていない`);
      // 単勝はオッズが実測値なので、期待値1割れを買うことはない
      if(under) assert.notStrictEqual(b.kind, "tan", `${key}: 単勝で期待値1割れを買っている`);
    });
  });
});

t("券種には的中判定用の種別が付いている", () => {
  const rows = E.analyze(race({condition:2}), lively(14));
  const {bets} = E.buildBets(rows, 30000,
    {policy:"balance", extras:{sanrenpuku:true, sanrentan:true}});
  const known = ["tan","fuku","umaren","wide","sanrenpuku","sanrentan"];
  bets.forEach(b => assert.ok(known.indexOf(b.kind) >= 0,
    `${b.name} の種別が不明: ${b.kind}`));
});

t("券種の推定期待値は、1点ごとの平均になる", () => {
  const rows = E.analyze(race(), lively(12));
  const {bets} = E.buildBets(rows, 20000);
  bets.filter(b => b.evKnown == null && b.points.length > 1).forEach(b => {
    const avg = b.points.reduce((s, pt) => s + pt.ev, 0) / b.points.length;
    assert.ok(Math.abs(b.evEst - avg) < 1e-9, `${b.name}: ${b.evEst} と ${avg}`);
  });
});

console.log("\n■ 買う券種を選ぶ");

/* 連系が確実に出るレース（材料が揃い、市場と見立てがずれる） */
function pickRace(){
  const race = {track:"nakayama", surface:"dirt", distance:1600,
                condition:2, pace:"high", budget:10000};
  const odds = [3.1,4.2,6.8,9.5,12.0,15.5,19.0,24.0,31.0,40.0,55.0,70.0,95.0,130.0];
  const hs = [];
  for(let i = 1; i <= 14; i++){
    hs.push(Object.assign(E.defaultHorse(i), {
      odds: odds[i-1],
      last1:((i*3)%9)+1, last2:((i*5)%9)+1, last3:((i*7)%9)+1,
      jockey:5-((i-1)%5), training:1+((i*2)%5), dist:(i+1)%4, baba:(i*3)%4,
      kinryo:54+(i%4), wdiff:(i%9)-4,
      style:["nige","senko","sashi","oikomi"][i%4]}));
  }
  return E.analyze(race, hs);
}
const PICK = pickRace();
const kindsIn = out => out.bets.map(b => b.kind);

t("指定しなければ、単勝・複勝・馬連・ワイドを出す", () => {
  const k = kindsIn(E.buildBets(PICK, 10000));
  ["tan","fuku","umaren","wide"].forEach(x =>
    assert.ok(k.indexOf(x) >= 0, x + " が出ていない: " + k.join(",")));
  ["sanrenpuku","sanrentan"].forEach(x =>
    assert.ok(k.indexOf(x) < 0, x + " が既定で出ている"));
});

t("券種ごとに、出す・出さないを切り替えられる", () => {
  ["tan","fuku","umaren","wide"].forEach(off => {
    const k = kindsIn(E.buildBets(PICK, 10000, {kinds: {[off]: false}}));
    assert.ok(k.indexOf(off) < 0, `${off} を外したのに出ている: ${k.join(",")}`);
    // 外していない券種は残る
    ["tan","fuku","umaren","wide"].filter(x => x !== off).forEach(on =>
      assert.ok(k.indexOf(on) >= 0, `${off} を外したら ${on} まで消えた`));
  });
  ["sanrenpuku","sanrentan"].forEach(on => {
    const k = kindsIn(E.buildBets(PICK, 30000, {kinds: {[on]: true}}));
    assert.ok(k.indexOf(on) >= 0, `${on} を足したのに出ない: ${k.join(",")}`);
  });
});

t("1券種だけに絞れる", () => {
  const only = kind => {
    const kinds = {};
    Object.keys(E.KIND_LABEL).forEach(x => { kinds[x] = (x === kind); });
    return E.buildBets(PICK, 10000, {kinds: kinds});
  };
  ["tan","fuku","umaren","wide"].forEach(kind => {
    const out = only(kind);
    assert.ok(out.bets.length, kind + " だけにすると買い目が消える");
    out.bets.forEach(b => assert.strictEqual(b.kind, kind,
      `${kind} だけのはずが ${b.kind} が混ざっている`));
  });
});

t("ワイドは馬連より当たる（同じレース・同じ選び方で）", () => {
  const only = kind => {
    const kinds = {};
    Object.keys(E.KIND_LABEL).forEach(x => { kinds[x] = (x === kind); });
    return E.buildBets(PICK, 10000, {kinds: kinds});
  };
  const w = only("wide"), u = only("umaren");
  assert.ok(w.hitChance > u.hitChance,
    `ワイド ${(w.hitChance*100).toFixed(1)}% ≦ 馬連 ${(u.hitChance*100).toFixed(1)}%`);
});

t("すべて外すと、買い目も的中確率も0になる", () => {
  const kinds = {};
  Object.keys(E.KIND_LABEL).forEach(x => { kinds[x] = false; });
  const out = E.buildBets(PICK, 10000, {kinds: kinds});
  assert.strictEqual(out.bets.length, 0, "外したのに買い目がある");
  assert.strictEqual(out.hitChance, 0);
});

t("更新前の指定（extras）でも、これまでどおり動く", () => {
  const k = kindsIn(E.buildBets(PICK, 30000, {extras: {sanrenpuku:true}}));
  assert.ok(k.indexOf("sanrenpuku") >= 0, "extras で三連複が出ない");
  assert.ok(k.indexOf("tan") >= 0 && k.indexOf("wide") >= 0, "既定の券種が消えた");
});

console.log("\n■ 資金の保ち方");

t("当たらない連続の長さは、的中率が低いほど長くなる", () => {
  const a = E.longestMissRun(0.35, 100);
  const b = E.longestMissRun(0.65, 100);
  const c = E.longestMissRun(0.90, 100);
  assert.ok(a > b && b > c, `${a} > ${b} > ${c} になっていない`);
  // レース数が増えれば、いちばん長い連敗も伸びる
  assert.ok(E.longestMissRun(0.35, 300) >= a);
  assert.strictEqual(E.longestMissRun(0, 100), null, "的中率0は出せないはず");
  assert.strictEqual(E.longestMissRun(1, 100), 0, "必ず当たるなら連敗は0");
  assert.strictEqual(E.longestMissRun(0.5, 0), null);
});

t("資金の割合で買えば、連敗しても0にはならない", () => {
  const p = E.bankrollPlan(100000, 2, 0.35, 100);
  assert.ok(p.stake === 2000, "1レースの額が合わない: " + p.stake);
  assert.ok(p.after > 0, "連敗で0になっている");
  assert.ok(p.after < 100000, "減っていない");
  assert.ok(p.afterPct > 0.5 && p.afterPct < 1, "残りの割合が変: " + p.afterPct);
});

t("割合を上げるほど、連敗のあとの残りは減る", () => {
  const lo = E.bankrollPlan(100000, 1, 0.35, 100);
  const hi = E.bankrollPlan(100000, 5, 0.35, 100);
  assert.ok(hi.after < lo.after, `5%(${hi.after}) が 1%(${lo.after}) より多い`);
  assert.strictEqual(lo.run, hi.run, "連敗の長さは賭け金で変わらないはず");
});

t("「半分を残す上限」を守れば、連敗しても半分は残る", () => {
  [0.20, 0.35, 0.65, 0.90].forEach(h => {
    const p = E.bankrollPlan(100000, 2, h, 100);
    const at = E.bankrollPlan(100000, p.safePct, h, 100);
    assert.ok(at.afterPct >= 0.499, `的中${h}: 上限 ${p.safePct}% でも ${at.afterPct} しか残らない`);
    // 的中率が低いほど、賭けてよい割合は小さくなる
    assert.ok(p.safePct > 0 && p.safePct <= 100, "上限が範囲外: " + p.safePct);
  });
  const low  = E.bankrollPlan(100000, 2, 0.25, 100).safePct;
  const high = E.bankrollPlan(100000, 2, 0.80, 100).safePct;
  assert.ok(low < high, `当たりにくいほど上限が小さくなっていない: ${low} / ${high}`);
});

t("資金を入れていなくても落ちない", () => {
  const p = E.bankrollPlan(0, 2, 0.35, 100);
  assert.strictEqual(p.stake, 0);
  assert.strictEqual(p.after, 0);
  assert.ok(p.run > 0, "連敗の目安は資金が無くても出せるはず");
});

console.log("\n■ 三連単");

t("推定期待値の高い並びだけを、点数を絞って買う", () => {
  const rows = E.analyze(race({condition:2}), lively(12));
  const {bets} = E.buildBets(rows, 30000);
  const st = bets.find(b => b.name === "三連単");
  if(!st){ assert.ok(true, "買える並びが無いレースもある"); return; }
  assert.ok(st.combos.length <= E.SANRENTAN_MAX, "点数: " + st.combos.length);
  st.points.forEach(pt => assert.ok(pt.ev >= E.SANRENTAN_EV,
    `${pt.combo} の推定期待値 ${pt.ev.toFixed(2)} が下限 ${E.SANRENTAN_EV} 未満`));
  // 期待値の高い順に並ぶ
  for(let i=1;i<st.points.length;i++)
    assert.ok(st.points[i-1].ev >= st.points[i].ev - 1e-12, "期待値の降順でない");
});

t("三連単は当たりやすさで選ばない（人気どうしの並びに偏らない）", () => {
  const rows = E.analyze(race({condition:2}), lively(12));
  const {bets} = E.buildBets(rows, 30000);
  const st = bets.find(b => b.name === "三連単");
  if(!st) return;
  /* 当たりやすさで選んでいれば、いちばん当たりやすい並び（上位3頭の順）が
     必ず入る。期待値で選ぶなら、割が悪ければ入らない。 */
  const top3 = rows.slice(0,3).map(x => x.h.num).join("-");
  const byHit = st.points.slice().sort((x,y) => y.hit - x.hit);
  assert.ok(st.points[0].combo !== byHit[0].combo || st.points.length === 1,
    "期待値順と的中率順が同じ＝当たりやすさで選んでいる可能性がある");
});

t("三連単は着順どおりの並びで、同じ並びを2度出さない", () => {
  const rows = E.analyze(race({condition:2}), lively(12));
  const {bets} = E.buildBets(rows, 30000);
  const st = bets.find(b => b.name === "三連単");
  if(!st) return;
  const nums = new Set(rows.map(x => String(x.h.num)));
  const seen = new Set();
  st.points.forEach(pt => {
    const parts = pt.combo.split("-");
    assert.strictEqual(parts.length, 3, "3頭の並びでない: " + pt.combo);
    assert.strictEqual(new Set(parts).size, 3, "同じ馬が重複: " + pt.combo);
    parts.forEach(x => assert.ok(nums.has(x), "出走馬でない馬番: " + x));
    assert.ok(!seen.has(pt.combo), "同じ並びが2度出ている: " + pt.combo);
    seen.add(pt.combo);
  });
});

t("3頭立てでは三連単を出さない", () => {
  const {bets} = E.buildBets(E.analyze(race(), lively(3)), 5000);
  assert.ok(!bets.some(b => b.name === "三連単"));
});

console.log("\n■ 荒れるレースで人気薄を拾う");

/* 人気薄のほうが近走成績も騎手も上、という組み立て。
   実際に「9番人気が絡んで荒れる」のはこういうレース。 */
function darkHorseRace(){
  return [
    {num:1, odds:2.1,  last1:5,last2:6,last3:4, jockey:3, style:"nige"},
    {num:2, odds:4.2,  last1:4,last2:5,last3:6, jockey:3, style:"senko"},
    {num:3, odds:6.5,  last1:3,last2:4,last3:5, jockey:3, style:"sashi"},
    {num:4, odds:9.0,  last1:6,last2:7,last3:8, jockey:2, style:"nige"},
    {num:5, odds:12.0, last1:5,last2:3,last3:4, jockey:3, style:"sashi"},
    {num:6, odds:18.0, last1:7,last2:8,last3:7, jockey:2, style:"nige"},
    {num:7, odds:25.0, last1:4,last2:6,last3:5, jockey:3, style:"oikomi"},
    {num:8, odds:33.0, last1:2,last2:8,last3:6, jockey:4, style:"sashi"},
    {num:9, odds:48.0, last1:1,last2:2,last3:3, jockey:5, style:"sashi"},  // 9番人気・近走最上位
    {num:10,odds:70.0, last1:8,last2:8,last3:8, jockey:1, style:"oikomi"},
    {num:11,odds:95.0, last1:6,last2:7,last3:8, jockey:2, style:"nige"},
    {num:12,odds:130.0,last1:8,last2:8,last3:8, jockey:1, style:"oikomi"}
  ].map(h => horse(h.num, h));
}
const DARK = race({track:"nakayama", surface:"turf", distance:1600, condition:2});

t("実力のある9番人気を妙味として拾う", () => {
  const rows = E.analyze(DARK, darkHorseRace());
  const x = rows.find(y => y.h.num === 9);
  assert.ok(E.isValue(x), `9番の期待値 ${x.ev.toFixed(2)} で妙味にならない`);
  assert.ok(x.ev > 2, "期待値が低すぎる: " + x.ev.toFixed(2));
});

t("荒れると読んだレースでは、人気薄を相手に入れる", () => {
  const {bets, upset} = E.buildBets(E.analyze(DARK, darkHorseRace()), 10000);
  assert.strictEqual(upset.level, "high", "荒れ度: " + upset.label);
  const inBets = new Set();
  bets.forEach(b => b.combos.forEach(c => c.split("-").forEach(x => inBets.add(Number(x)))));
  assert.ok(inBets.has(9), "9番人気が買い目に1つも入っていない: " + [...inBets].join(","));
});

t("堅いレースでは人気薄を無理に入れない", () => {
  // 人気順どおりの実力なら、相手は上位から順に取る
  const hs = [];
  for(let i=0;i<8;i++) hs.push(horse(i+1, {
    odds: [2,3.5,5,8,13,20,35,60][i],
    last1:i+1, last2:i+1, last3:i+1,
    jockey: Math.max(1,5-i), training: Math.max(1,5-i),
    style: i === 0 ? "nige" : ["senko","sashi","oikomi"][i%3]
  }));
  const rows = E.analyze(race(), hs);
  const {bets, upset} = E.buildBets(rows, 10000);
  if(upset.level !== "low") return;                 // 条件が揃わなければ検証しない
  const inBets = new Set();
  bets.forEach(b => b.combos.forEach(c => c.split("-").forEach(x => inBets.add(Number(x)))));
  assert.ok(![7,8].some(v => inBets.has(v)),
    "堅いレースで下位人気を入れている: " + [...inBets].join(","));
});

console.log("\n■ 買い下限オッズ（締切間際の判断用）");

t("買い下限を上回っていることと、期待値が1以上であることは一致する", () => {
  /* これが崩れると、締切間際に買い下限だけ見て判断できなくなる。 */
  const hs = lively(12);
  const r = race({track:"morioka", surface:"dirt", distance:1000});
  const rows = E.fillBreakEven(r, hs, E.analyze(r, hs));
  rows.forEach(x => {
    if(x.minOdds == null){
      assert.ok(x.ev < 1.0, `買えない判定なのに期待値 ${x.ev.toFixed(2)}（${x.h.num}番）`);
      return;
    }
    const buyable = x.h.odds >= x.minOdds;
    assert.strictEqual(buyable, x.ev >= 1.0,
      `${x.h.num}番: オッズ${x.h.odds} 下限${x.minOdds} 期待値${x.ev.toFixed(2)} が食い違う`);
  });
});

t("買い下限ちょうどのオッズなら、期待値がほぼ1になる", () => {
  // 「オッズが動けば推定勝率も動く」ことを織り込めているかの検算
  const hs = lively(10);
  const r = race();
  const rows = E.fillBreakEven(r, hs, E.analyze(r, hs));
  rows.filter(x => x.minOdds != null && x.minOdds > 1.0).forEach(x => {
    const at = hs.map(h => h.num === x.h.num ? Object.assign({}, h, {odds: x.minOdds}) : h);
    const ev = E.analyze(r, at).find(y => y.h.num === x.h.num).ev;
    assert.ok(ev >= 0.98 && ev <= 1.15,
      `${x.h.num}番 下限${x.minOdds}倍 のときの期待値が ${ev.toFixed(3)}`);
  });
});

t("どんなオッズでも買えない馬は null にする", () => {
  // 能力が最下位で人気だけある馬は、オッズがいくら付いても買い頃にならないことがある
  const hs = lively(8);
  const r = race();
  const rows = E.fillBreakEven(r, hs, E.analyze(r, hs));
  assert.ok(rows.every(x => x.minOdds === null || x.minOdds >= 1.0), "1倍未満の下限が出ている");
  assert.ok(rows.some(x => x.minOdds != null), "全馬が買えない判定になっている");
});

t("取消馬は買い下限の計算に含めない", () => {
  const hs = lively(10);
  hs[9].scratched = true;
  const r = race();
  const rows = E.fillBreakEven(r, hs, E.analyze(r, hs));
  assert.strictEqual(rows.length, 9);
  assert.ok(!rows.some(x => x.h.num === 10));
  assert.ok(rows.every(x => "minOdds" in x), "買い下限が入っていない馬がある");
});

t("出走馬にいない馬番を渡しても落ちない", () => {
  assert.strictEqual(E.breakEvenOdds(race(), lively(8), 99), null);
});

t("複勝は5頭以上で2着まで、8頭以上で3着まで", () => {
  assert.strictEqual(E.placePositions(4), 0);
  assert.strictEqual(E.placePositions(5), 2);
  assert.strictEqual(E.placePositions(7), 2);
  assert.strictEqual(E.placePositions(8), 3);
  assert.strictEqual(E.placePositions(18), 3);
});

console.log("\n■ 荒れ度と、荒れたときの買い方");

/* 荒れ度を動かす条件を個別に与えられる場のつくり方 */
function rough(n, opts){
  opts = opts || {};
  const hs = [];
  for(let i=0;i<n;i++) hs.push(horse(i+1, {
    odds: opts.odds ? opts.odds[i] : 2 + i*3,
    last1:((i*3)%8)+1, last2:((i*5)%8)+1, last3:((i*7)%8)+1,
    jockey:(i%5)+1, training:((i+2)%5)+1,
    style: opts.nige != null
      ? (i < opts.nige ? "nige" : ["senko","sashi","oikomi"][i%3])
      : ["nige","senko","sashi","oikomi"][i%4]
  }));
  return hs;
}

t("荒れる条件が増えるほど荒れ度が上がる", () => {
  const calm  = E.analyze(race({track:"nakayama"}), rough(8, {nige:1})).upset;
  const mid   = E.analyze(race({track:"nakayama", condition:2}), rough(12, {nige:3})).upset;
  const storm = E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4})).upset;
  assert.ok(calm.score < mid.score && mid.score < storm.score,
    `単調でない: ${calm.score} → ${mid.score} → ${storm.score}`);
  assert.strictEqual(calm.level, "low", "落ち着いた条件が低評価にならない: " + calm.score);
  assert.strictEqual(storm.level, "high", "荒れる条件が高評価にならない: " + storm.score);
  assert.ok(storm.score <= 100 && calm.score >= 0);
});

t("荒れる材料を理由として挙げる", () => {
  const up = E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4})).upset;
  const joined = up.reasons.join("／");
  assert.ok(/逃げ馬が 4頭/.test(joined), "ペース崩壊の指摘がない: " + joined);
  assert.ok(/馬場/.test(joined), "道悪の指摘がない: " + joined);
  assert.ok(/16頭立て/.test(joined), "多頭数の指摘がない: " + joined);
  assert.ok(up.advice.length >= 3, "対処法が出ていない");
});

t("理由が1つも無くても、何か言う（空にしない）", () => {
  const up = E.analyze(race({track:"nakayama"}), rough(8, {nige:1})).upset;
  assert.ok(up.reasons.length >= 1, "理由が空");
  assert.ok(up.advice.length >= 1, "対処法が空");
});

t("荒れるレースほど相手を広げ、投入額は絞る", () => {
  const calm  = E.analyze(race({track:"nakayama"}), rough(8, {nige:1}));
  const storm = E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4}));
  assert.ok(storm.upset.width > calm.upset.width,
    `相手が広がっていない: ${calm.upset.width} → ${storm.upset.width}`);
  assert.ok(storm.upset.stakeScale < calm.upset.stakeScale,
    `投入額が絞られていない: ${calm.upset.stakeScale} → ${storm.upset.stakeScale}`);
  assert.strictEqual(calm.upset.stakeScale, 1.0, "堅いレースで減らしている");
});

t("荒れるレースでは単勝の比重を下げ、面で取る券種に回す", () => {
  const calm  = E.buildBets(E.analyze(race({track:"nakayama"}), rough(8, {nige:1})), 20000);
  const storm = E.buildBets(E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4})), 20000);
  const share = (b, name) => {
    const hit = b.bets.filter(x => x.name.indexOf(name) === 0);
    const used = b.bets.reduce((s,x)=>s+x.total, 0);
    return used ? hit.reduce((s,x)=>s+x.total, 0) / used : 0;
  };
  assert.ok(share(storm, "単勝") < share(calm, "単勝"),
    `単勝の比重が下がっていない: ${share(calm,"単勝").toFixed(2)} → ${share(storm,"単勝").toFixed(2)}`);
  /* 他の券種が条件を満たさず出てこなくても、単勝だけが残って
     比重が上がることがないよう上限を置いてある。 */
  assert.ok(share(storm, "単勝") <= 0.30,
    "荒れるレースで単勝の比重が高すぎる: " + share(storm, "単勝").toFixed(2));
  // 荒れるレースは候補も点数も広げる
  const wide = storm.bets.find(x => x.name === "ワイド");
  const calmW = calm.bets.find(x => x.name === "ワイド");
  assert.ok(wide, "ワイドが無い: " + storm.bets.map(x=>x.name).join(","));
  assert.ok(storm.upset.width === 5, "候補の広さが5でない: " + storm.upset.width);
  if(calmW) assert.ok(wide.combos.length + wide.cut >= calmW.combos.length + calmW.cut,
    `荒れるレースで候補が増えていない: ${calmW.combos.length} → ${wide.combos.length}`);
});

t("三連複・三連単は、明示して初めて出る", () => {
  const rows = E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4}));
  const off = E.buildBets(rows, 30000);
  assert.ok(!off.bets.some(x => x.kind === "sanrenpuku" || x.kind === "sanrentan"),
    "指定していないのに三連複・三連単が出ている: " + off.bets.map(x=>x.name).join(","));
  const on = E.buildBets(rows, 30000, {extras:{sanrenpuku:true, sanrentan:true}});
  assert.ok(on.bets.some(x => x.kind === "sanrenpuku"), "指定しても三連複が出ない");
});

t("荒れるレースでも、必要オッズは点数に応じて上がる", () => {
  // 手広く流せば当たりやすくなるが、必要オッズも上がる。それを隠さない。
  const storm = E.buildBets(E.analyze(race({track:"nakayama", condition:3}), rough(16, {nige:4})),
                            20000, {extras:{sanrenpuku:true}});
  const tri = storm.bets.find(x => x.name === "三連複");
  assert.ok(tri, "三連複が無い: " + storm.bets.map(x=>x.name).join(","));
  assert.ok(tri.combos.length + tri.cut >= 6,
    `三連複の候補: ${tri.combos.length} + 外した${tri.cut}`);
  assert.ok(Math.abs(tri.needOdds - tri.combos.length / tri.hit) < 1e-9);
  assert.ok(tri.needOdds > 20, "点数のわりに必要オッズが低すぎる: " + tri.needOdds);
});

t("荒れ度は取消馬を数に入れない", () => {
  const hs = rough(16, {nige:4});
  const full = E.analyze(race({track:"nakayama"}), hs).upset;
  hs.slice(12).forEach(h => { h.scratched = true; });
  const cut = E.analyze(race({track:"nakayama"}), hs).upset;
  assert.ok(cut.score < full.score, `取消後も同じ多頭数扱い: ${full.score} → ${cut.score}`);
});

console.log("\n■ ペース自動判定");

t("逃げ馬が多いとハイ、いないとスローになる", () => {
  assert.strictEqual(E.autoPace(field(6,{style:"nige"})).pace, "high");
  assert.strictEqual(E.autoPace(field(6,{style:"oikomi"})).pace, "slow");
  assert.strictEqual(E.autoPace([horse(1,{style:"nige"}),horse(2,{style:"senko"}),
                                 horse(3,{style:"sashi"})]).pace, "mid");
});

console.log("\n■ 出走取消");

t("取消馬は予想に出ず、勝率の分母にも入らない", () => {
  const hs = field(8).map((h,i) => Object.assign(h, {odds: 2 + i*2}));
  hs[3].scratched = true;
  const rows = E.analyze(race(), hs);
  assert.strictEqual(rows.length, 7, "予想対象: " + rows.length);
  assert.ok(!rows.some(x => x.h.num === 4), "取消馬が残っている");
  const sum = rows.reduce((a,x) => a + x.prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "勝率の合計が1でない: " + sum);
});

t("取消馬を外すと、残った馬の推定勝率が上がる", () => {
  // 人気馬が取消になった分は、他の馬に配分される
  const base = field(6).map((h,i) => Object.assign(h, {odds: [1.5,4,6,8,12,20][i]}));
  const before = E.analyze(race(), base).find(x => x.h.num === 2).prob;
  const after = E.analyze(race(), base.map((h,i) =>
    Object.assign({}, h, {scratched: i === 0}))).find(x => x.h.num === 2).prob;
  assert.ok(after > before, `取消後に勝率が上がっていない: ${before} → ${after}`);
});

t("ペース自動判定は取消馬を数えない", () => {
  const hs = field(6, {style:"oikomi"});
  [0,1,2].forEach(i => Object.assign(hs[i], {style:"nige", scratched:true}));
  assert.strictEqual(E.autoPace(hs).nige, 0);
  assert.strictEqual(E.autoPace(hs).pace, "slow");
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
