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

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
