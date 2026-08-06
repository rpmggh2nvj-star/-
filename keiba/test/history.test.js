/* 予想の記録と集計の検証。node keiba/test/history.test.js で実行する。 */
"use strict";
const assert = require("assert");
const H = require("../history.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

// 予想順に馬番を並べ、結果を与えた記録をつくる
function rec(track, predNums, jockeys, result){
  return {
    id: "x", savedAt: 0,
    race: {track: track, distance: 1200, surface: "dirt"},
    pred: predNums.map((n, i) => ({rank: i + 1, num: n, name: "馬" + n,
                                   jockeyName: jockeys ? jockeys[i] : "", odds: 2 + i})),
    bets: [],
    result: result || null
  };
}

console.log("\n■ レース成績の集計");

t("結果未入力の記録は成績に数えない", () => {
  const s = H.raceStats([rec("ooi", [1,2,3]), rec("ooi", [1,2,3])]);
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.done, 0);
  assert.strictEqual(s.winPct, null, "母数0で割合を出している");
});

t("◎の勝率・複勝率を数える", () => {
  const s = H.raceStats([
    rec("ooi", [1,2,3,4], null, {first:1, second:2, third:3}),   // ◎1着
    rec("ooi", [1,2,3,4], null, {first:3, second:1, third:4}),   // ◎2着（複勝圏）
    rec("ooi", [1,2,3,4], null, {first:4, second:3, third:2})    // ◎圏外
  ]);
  assert.strictEqual(s.done, 3);
  assert.strictEqual(s.win, 1);
  assert.strictEqual(s.show, 2);
  assert.strictEqual(s.winPct, 33.3, "winPct=" + s.winPct);
  assert.strictEqual(s.showPct, 66.7, "showPct=" + s.showPct);
});

t("印上位3頭に1着馬が入った率を数える", () => {
  const s = H.raceStats([
    rec("ooi", [1,2,3,4], null, {first:3, second:9, third:9}),   // ▲が1着 → 該当
    rec("ooi", [1,2,3,4], null, {first:4, second:9, third:9})    // △が1着 → 非該当
  ]);
  assert.strictEqual(s.top3, 1);
  assert.strictEqual(s.top3Pct, 50);
});

t("3着が空欄（同着なし・2頭立てなど）でも落ちない", () => {
  const s = H.raceStats([rec("ooi", [1,2], null, {first:2, second:1, third:0})]);
  assert.strictEqual(s.done, 1);
  assert.strictEqual(s.win, 0);
  assert.strictEqual(s.show, 1, "2着の◎が複勝圏に数えられていない");
});

console.log("\n■ 競馬場ごとの内訳");

t("競馬場ごとに分けて集計する", () => {
  const b = H.byTrack([
    rec("ooi", [1,2,3], null, {first:1, second:2, third:3}),
    rec("ooi", [1,2,3], null, {first:2, second:1, third:3}),
    rec("funabashi", [1,2,3], null, {first:1, second:2, third:3})
  ]);
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].track, "ooi", "件数の多い順になっていない");
  assert.strictEqual(b[0].records.length, 2);
  assert.strictEqual(b[0].stats.win, 1);
  assert.strictEqual(b[1].stats.win, 1);
});

console.log("\n■ 騎手成績");

t("出走馬すべての騎手を数える（◎の馬だけではない）", () => {
  const j = H.jockeyStats([
    rec("ooi", [1,2,3], ["武豊","森泰斗","矢野貴之"], {first:2, second:1, third:3})
  ]);
  assert.strictEqual(j.length, 3, "騎手数: " + j.length);
  const mori = j.find(x => x.name === "森泰斗");
  assert.strictEqual(mori.win, 1);
  assert.strictEqual(mori.show, 1);
  const take = j.find(x => x.name === "武豊");
  assert.strictEqual(take.win, 0);
  assert.strictEqual(take.quinella, 1, "2着が連対に数えられていない");
});

t("勝率・連対率・複勝率を出す", () => {
  const rs = [];
  for(let i=0;i<4;i++) rs.push(rec("ooi", [1,2], ["A","B"], {first:1, second:2, third:0}));
  const j = H.jockeyStats(rs);
  const a = j.find(x => x.name === "A");
  assert.strictEqual(a.rides, 4);
  assert.strictEqual(a.winPct, 100);
  const b = j.find(x => x.name === "B");
  assert.strictEqual(b.winPct, 0);
  assert.strictEqual(b.quinellaPct, 100);
});

t("騎手名がない馬は数えない", () => {
  const j = H.jockeyStats([rec("ooi", [1,2], ["", ""], {first:1, second:2, third:0})]);
  assert.strictEqual(j.length, 0);
});

console.log("\n■ 評価の提案");

t("騎乗数が少ないうちは提案しない", () => {
  assert.strictEqual(H.suggestGrade({rides: 9, win: 9}), null,
    "9戦9勝でも提案してはいけない（偶然と区別できない）");
  assert.strictEqual(H.suggestGrade({rides: 0, win: 0}), null);
  assert.strictEqual(H.suggestGrade(null), null);
});

t("勝率に応じて S〜D を提案する", () => {
  assert.strictEqual(H.suggestGrade({rides:100, win:25}), 5, "勝率25% → S");
  assert.strictEqual(H.suggestGrade({rides:100, win:15}), 4, "勝率15% → A");
  assert.strictEqual(H.suggestGrade({rides:100, win:9}),  3, "勝率9% → B");
  assert.strictEqual(H.suggestGrade({rides:100, win:5}),  2, "勝率5% → C");
  assert.strictEqual(H.suggestGrade({rides:100, win:1}),  1, "勝率1% → D");
});

t("目安の表は5段階すべてを網羅する", () => {
  assert.strictEqual(H.GRADE_GUIDE.length, 5);
  assert.deepStrictEqual(H.GRADE_GUIDE.map(g => g.v), [5,4,3,2,1]);
});

console.log("\n■ 記録の保存");

t("予想結果から記録を組み立てる", () => {
  const race = {track:"ooi", surface:"dirt", distance:1600, condition:1, pace:"mid", budget:5000};
  const rows = [
    {h:{num:3, name:"アイウエオ", jockeyName:"森泰斗", style:"nige", odds:2.4},
     score:45.67, prob:0.34567, ev:0.829, edge:1.234},
    {h:{num:1, name:"カキクケコ", jockeyName:"武豊", style:"sashi", odds:5.0},
     score:38.2, prob:0.2, ev:1.0, edge:0.9}
  ];
  const r = H.makeRecord(race, rows, [{name:"単勝", combos:["3"], unit:900, total:900}], 1000);
  assert.strictEqual(r.race.track, "ooi");
  assert.strictEqual(r.pred.length, 2);
  assert.strictEqual(r.pred[0].num, 3);
  assert.strictEqual(r.pred[0].jockeyName, "森泰斗");
  assert.strictEqual(r.pred[0].score, 45.7, "指数が丸められていない");
  assert.strictEqual(r.pred[0].ev, 0.83);
  assert.strictEqual(r.bets[0].total, 900);
  assert.strictEqual(r.result, null);
});

t("新しい記録が先頭に入り、上限を超えたら古いものが落ちる", () => {
  let list = [];
  for(let i=0;i<H.MAX_RECORDS + 5;i++) list = H.addRecord(list, {id:"r"+i, savedAt:i});
  assert.strictEqual(list.length, H.MAX_RECORDS);
  assert.strictEqual(list[0].id, "r" + (H.MAX_RECORDS + 4), "最新が先頭にない");
  assert.ok(!list.some(x => x.id === "r0"), "最古の記録が残っている");
});

console.log("\n■ 更新をまたいでも記録を失わない");

/* アプリを更新するたびに記録の項目が増える。すでに端末に保存されている
   古い記録が、更新後も読めて・表示できて・集計に入ることを確かめる。 */
const OLD_RECORD = {          // grade も upset も無い、更新前の形
  id: "r1700000000000",
  savedAt: 1700000000000,
  race: {track:"ooi", surface:"dirt", distance:1600, condition:1, pace:"mid", budget:5000},
  pred: [
    {rank:1, num:3, name:"アイウエオ", jockeyName:"森泰斗", style:"nige", odds:2.4,
     score:45.7, prob:0.3457, ev:0.83, edge:1.23},
    {rank:2, num:1, name:"カキクケコ", jockeyName:"武豊", style:"sashi", odds:5.0,
     score:38.2, prob:0.2, ev:1.0, edge:0.9}
  ],
  bets: [{name:"単勝", combos:["3"], unit:900, total:900}],
  result: {first:3, second:1, third:5}
};

t("更新前の記録がそのまま残る（消さない・書き換えない）", () => {
  const out = H.normalize([OLD_RECORD]);
  assert.strictEqual(out.length, 1, "記録が消えた");
  const r = out[0];
  assert.strictEqual(r.id, OLD_RECORD.id);
  assert.strictEqual(r.savedAt, OLD_RECORD.savedAt);
  assert.deepStrictEqual(r.pred, OLD_RECORD.pred, "予想が書き換わっている");
  assert.deepStrictEqual(r.bets, OLD_RECORD.bets, "買い目が書き換わっている");
  assert.deepStrictEqual(r.result, OLD_RECORD.result, "着順が書き換わっている");
  assert.deepStrictEqual(r.race, OLD_RECORD.race, "レース条件が書き換わっている");
});

t("新しい項目は null で埋め、後から判定し直さない", () => {
  const r = H.normalize([OLD_RECORD])[0];
  assert.strictEqual(r.grade, null, "当時なかったレース評価を作っている");
  assert.strictEqual(r.upset, null, "当時なかった荒れ度を作っている");
});

t("更新前の記録も集計に入る", () => {
  const out = H.normalize([OLD_RECORD]);
  const s = H.raceStats(out);
  assert.strictEqual(s.done, 1, "着順入りとして数えられていない");
  assert.strictEqual(s.win, 1, "◎の1着が数えられていない");
  const jk = H.jockeyStats(out);
  assert.ok(jk.some(x => x.name === "森泰斗" && x.win === 1), "騎手成績に入っていない");
  assert.strictEqual(H.byTrack(out).length, 1);
});

t("壊れた記録があっても、他の記録は残す", () => {
  const out = H.normalize([OLD_RECORD, null, "こわれた", {}, {id:"x"}, {savedAt:1}]);
  assert.strictEqual(out.length, 1, "巻き添えで消えている: " + out.length);
  assert.strictEqual(out[0].id, OLD_RECORD.id);
});

t("配列でないものを渡しても空配列を返す", () => {
  assert.deepStrictEqual(H.normalize(null), []);
  assert.deepStrictEqual(H.normalize({}), []);
  assert.deepStrictEqual(H.normalize("[]"), []);
});

t("欠けた項目があっても既定値で形が揃う", () => {
  const out = H.normalize([{id:"a", savedAt:1}]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].pred, []);
  assert.deepStrictEqual(out[0].bets, []);
  assert.deepStrictEqual(out[0].race, {});
  assert.strictEqual(out[0].result, null);
});

console.log("\n■ 荒れたレースの記録");

const upRec = (id, level, first, pred) => ({
  id: id, savedAt: Number(id.slice(1)),
  upset: {score: 50, level: level, label: level},
  race: {track:"ooi"}, pred: pred, bets: [],
  result: {first: first, second: 0, third: 0}
});
const PRED = [
  {rank:1, num:1, odds:2.0, jockeyName:"あ"},
  {rank:2, num:2, odds:4.0, jockeyName:"い"},
  {rank:3, num:3, odds:8.0, jockeyName:"う"},
  {rank:4, num:4, odds:30.0, jockeyName:"え"}
];

t("実際に荒れたかを結果から判定する", () => {
  // ◎が勝てば荒れていない
  assert.strictEqual(H.wasUpset(upRec("r1","low",1,PRED)), false);
  // 予想4位以下が勝てば荒れた
  assert.strictEqual(H.wasUpset(upRec("r2","high",4,PRED)), true);
  // 上位3頭でも10倍以上の人気薄なら荒れた
  assert.strictEqual(H.wasUpset(upRec("r3","mid",3,PRED)), false, "8.0倍は人気薄ではない");
  const p = PRED.map(x => x.num === 3 ? Object.assign({}, x, {odds:12.0}) : x);
  assert.strictEqual(H.wasUpset(upRec("r4","mid",3,p)), true, "12倍の勝ちを荒れ扱いしていない");
  // 予想に無い馬が勝ったら荒れた
  assert.strictEqual(H.wasUpset(upRec("r5","low",9,PRED)), true);
  // 着順未入力は判定しない
  assert.strictEqual(H.wasUpset({id:"r6", pred:PRED, result:null}), null);
});

t("荒れ度ごとに、実際に荒れた割合を集計する", () => {
  const list = [
    upRec("r1","low",1,PRED), upRec("r2","low",2,PRED),      // 堅い: 荒れ0/2
    upRec("r3","high",4,PRED), upRec("r4","high",4,PRED),
    upRec("r5","high",1,PRED)                              // 荒れやすい: 荒れ2/3
  ];
  const by = H.byUpset(list);
  const low = by.find(x => x.level === "low");
  const high = by.find(x => x.level === "high");
  assert.strictEqual(low.done, 2);
  assert.strictEqual(low.roughPct, 0, "堅いレースを荒れ扱いしている");
  assert.strictEqual(high.done, 3);
  assert.ok(Math.abs(high.roughPct - 66.7) < 0.1, "荒れやすいの集計が違う: " + high.roughPct);
  assert.ok(!by.some(x => x.level === "mid"), "記録の無い段階を出している");
});

t("荒れ度が無い（更新前の）記録は荒れ度の集計に入れない", () => {
  const by = H.byUpset(H.normalize([OLD_RECORD]));
  assert.deepStrictEqual(by, [], "荒れ度不明の記録を集計に入れている");
});

t("記録にレース評価と荒れ度を残せる", () => {
  const r = H.makeRecord({track:"ooi"}, [], [], 1000,
    {grade:"strong", title:"勝負できる", bestEv:1.234},
    {score:72, level:"high", label:"荒れやすい"});
  assert.deepStrictEqual(r.grade, {grade:"strong", title:"勝負できる", bestEv:1.23});
  assert.deepStrictEqual(r.upset, {score:72, level:"high", label:"荒れやすい"});
  // 渡されなければ null（CLIなど、判定を持たない呼び出しでも壊れない）
  const r2 = H.makeRecord({track:"ooi"}, [], [], 1000);
  assert.strictEqual(r2.grade, null);
  assert.strictEqual(r2.upset, null);
});

console.log("\n■ 収支");

const money = (id, savedAt, spent, payout) => ({
  id: id, savedAt: savedAt, race: {track:"ooi"},
  pred: [{rank:1, num:1, odds:2.0, prob:0.5}], bets: [],
  money: (spent == null) ? null : {spent: spent, payout: payout},
  result: {first: 1}
});

t("投入と払戻を入れた記録だけを数える", () => {
  const list = H.normalize([
    money("a", 1, 1000, 1500),
    money("b", 2, 1000, 0),
    money("c", 3, null, null)          // 未入力
  ]);
  const m = H.moneyStats(list);
  assert.strictEqual(m.races, 2, "件数: " + m.races);
  assert.strictEqual(m.spent, 2000);
  assert.strictEqual(m.payout, 1500);
  assert.strictEqual(m.profit, -500);
  assert.ok(Math.abs(m.roi - 0.75) < 1e-9, "回収率: " + m.roi);
  assert.ok(Math.abs(m.hit - 0.5) < 1e-9, "的中率: " + m.hit);
});

t("払戻0（外れ）も数える。未入力とは区別する", () => {
  assert.strictEqual(H.hasMoney(H.normalizeRecord(money("a", 1, 1000, 0))), true);
  assert.strictEqual(H.hasMoney(H.normalizeRecord(money("b", 1, null, null))), false);
  // 投入が0のものは数えない（買っていない）
  assert.strictEqual(H.hasMoney(H.normalizeRecord(money("c", 1, 0, 0))), false);
});

t("壊れた収支は落とす（負の値・数値でないもの）", () => {
  const bad = H.normalizeRecord({id:"x", savedAt:1, money:{spent:-100, payout:"あ"}, result:{first:1}});
  assert.strictEqual(bad.money, null);
  const half = H.normalizeRecord({id:"y", savedAt:1, money:{spent:1000}, result:{first:1}});
  assert.deepStrictEqual(half.money, {spent:1000, payout:null});
  assert.strictEqual(H.hasMoney(half), false, "払戻が無いのに数えている");
});

t("日ごとにまとめられ、新しい日が先に来る", () => {
  const d1 = new Date(2026, 7, 5, 12, 0).getTime();
  const d2 = new Date(2026, 7, 6, 12, 0).getTime();
  const days = H.byDay(H.normalize([
    money("a", d1, 1000, 0), money("b", d1, 1000, 3000), money("c", d2, 1000, 500)
  ]));
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].day, H.dayKey(d2), "新しい日が先に来ていない");
  assert.strictEqual(days[1].money.races, 2);
  assert.ok(Math.abs(days[1].money.roi - 1.5) < 1e-9, "その日の回収率: " + days[1].money.roi);
});

t("目標に届いているかを判定する", () => {
  const hit  = H.dayPlan({spent:10000, payout:14000}, 1.30, 1000);
  assert.strictEqual(hit.reached, true);
  assert.strictEqual(hit.shortfall, 0);
  const miss = H.dayPlan({spent:10000, payout:9000}, 1.30, 1000);
  assert.strictEqual(miss.reached, false);
  assert.strictEqual(miss.shortfall, 4000, "不足額: " + miss.shortfall);
});

t("取り返すのに必要な回収率は、賭ける額が小さいほど跳ね上がる", () => {
  const m = {spent:8000, payout:4000};
  const a = H.dayPlan(m, 1.30, 1000).needRoi;
  const b = H.dayPlan(m, 1.30, 2000).needRoi;
  const c = H.dayPlan(m, 1.30, 8000).needRoi;
  assert.ok(a > b && b > c, `${a} > ${b} > ${c} になっていない`);
  // 投入8000・払戻4000 のとき、あと2000円で届かせるには 450% 必要
  assert.ok(Math.abs(b - 4.5) < 1e-9, "必要な回収率: " + b);
});

t("まだ買っていない日は、目標の判定を出さない", () => {
  const p = H.dayPlan({spent:0, payout:0}, 1.30, 1000);
  assert.strictEqual(p.reached, false);
  assert.strictEqual(p.roi, null);
  assert.strictEqual(p.needRoi, null);
});

t("提案した買い目の合計を、投入額の既定値にできる", () => {
  const r = {bets:[{total:1200},{total:800},{total:0}]};
  assert.strictEqual(H.suggestedSpend(r), 2000);
  assert.strictEqual(H.suggestedSpend({}), 0);
  assert.strictEqual(H.suggestedSpend(null), 0);
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
