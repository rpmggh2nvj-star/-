/* データの書き出し・読み込みの検証。node keiba/test/backup.test.js で実行する。

   ここでいちばん大事なのは「復元で今のデータを失わない」こと。
   取り違えたファイルを弾くこと、既定では足すだけであることを重点的に見る。 */
"use strict";
const assert = require("assert");
const B = require("../backup.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

const rec = (id, savedAt, done) => ({
  id: id, savedAt: savedAt,
  race: {track:"ooi"}, pred: [{rank:1, num:1, odds:2.0}], bets: [],
  result: done ? {first:1, second:2, third:3} : null
});

console.log("\n■ 書き出し");

t("すべての保存領域を1つのファイルにまとめる", () => {
  const o = B.build({history:[rec("a",1)], jockeys:{"武豊":5}, jockeyNames:["武豊"], state:{x:1}}, 1700000000000);
  assert.strictEqual(o.format, B.FORMAT);
  assert.strictEqual(o.version, B.FORMAT_VERSION);
  assert.strictEqual(o.savedAt, 1700000000000);
  assert.strictEqual(o.data.history.length, 1);
  assert.deepStrictEqual(o.data.jockeys, {"武豊":5});
  assert.deepStrictEqual(o.data.jockeyNames, ["武豊"]);
  assert.deepStrictEqual(o.data.state, {x:1});
});

t("空の端末でも書き出せる（欠けた領域は既定値で埋める）", () => {
  const o = B.build({}, 0);
  assert.deepStrictEqual(o.data.history, []);
  assert.deepStrictEqual(o.data.jockeys, {});
  assert.deepStrictEqual(o.data.jockeyNames, []);
  assert.strictEqual(o.data.state, null);
  assert.strictEqual(B.validate(o).ok, true, "自分で書いたものが読み込めない");
});

t("保存領域の一覧と実際の書き出しが一致する", () => {
  // STORES に足し忘れると、その領域だけ持ち出せなくなる
  const o = B.build({}, 0);
  assert.deepStrictEqual(Object.keys(o.data), B.STORES.map(s => s.name));
  B.STORES.forEach(s => assert.ok(s.key && s.label, s.name + " に key/label がない"));
});

t("ファイル名に日時が入り、続けて書き出しても衝突しない", () => {
  const a = B.fileName(new Date("2026-08-05T09:30:00").getTime());
  const b = B.fileName(new Date("2026-08-05T09:31:00").getTime());
  assert.ok(/^turf-logic-\d{8}-\d{4}\.json$/.test(a), a);
  assert.notStrictEqual(a, b);
});

console.log("\n■ 読み込む前の確認");

t("このアプリのバックアップ以外は受け付けない", () => {
  assert.strictEqual(B.validate(null).ok, false);
  assert.strictEqual(B.validate([]).ok, false);
  assert.strictEqual(B.validate("{}").ok, false);
  assert.strictEqual(B.validate({}).ok, false);
  assert.strictEqual(B.validate({format:"other", version:1, data:{}}).ok, false);
  const r = B.validate({format:B.FORMAT, version:1});
  assert.strictEqual(r.ok, false);
  assert.ok(/中身がありません/.test(r.reason), r.reason);
});

t("新しい形式のファイルは、そうと分かる理由で断る", () => {
  const r = B.validate({format:B.FORMAT, version:99, data:{}});
  assert.strictEqual(r.ok, false);
  assert.ok(/アプリを更新/.test(r.reason), r.reason);
});

t("中身の型が壊れていれば断る", () => {
  const r = B.validate({format:B.FORMAT, version:1, data:{history:{}}});
  assert.strictEqual(r.ok, false);
  assert.ok(/予想の記録/.test(r.reason), r.reason);
  const r2 = B.validate({format:B.FORMAT, version:1, data:{jockeys:[]}});
  assert.strictEqual(r2.ok, false);
  assert.ok(/騎手評価/.test(r2.reason), r2.reason);
});

t("一部の領域が無いバックアップは受け付ける", () => {
  assert.strictEqual(B.validate({format:B.FORMAT, version:1, data:{history:[]}}).ok, true);
});

t("中身の件数を先に示せる", () => {
  const s = B.summarize(B.build({history:[rec("a",1),rec("b",2)], jockeys:{a:1,b:2,c:3},
                                 jockeyNames:["x"], state:{}}, 5));
  assert.deepStrictEqual(s, {savedAt:5, history:2, jockeys:3, jockeyNames:1,
                             hasState:true, hasTune:false, tuneRaces:0});
  const withTune = B.summarize(B.build({history:[], jockeys:{}, jockeyNames:[], state:null,
                                        tune:{weights:{form:1.2}, races:140}}, 5));
  assert.strictEqual(withTune.hasTune, true);
  assert.strictEqual(withTune.tuneRaces, 140);
});

t("学習した重みは、より多くのレースから学んだ方を残す", () => {
  const a = {weights:{form:1.1}, races:60}, b = {weights:{form:1.4}, races:200};
  assert.strictEqual(B.pickTune(a, b), b);
  assert.strictEqual(B.pickTune(b, a), b);
  assert.strictEqual(B.pickTune(null, b), b);
  assert.strictEqual(B.pickTune(a, null), a);
  assert.strictEqual(B.pickTune(null, null), null);
  // 重みを持たない壊れたものは採らない
  assert.strictEqual(B.pickTune(a, {races: 999}), a);
});

t("v1（学習の無い）バックアップも読める", () => {
  const old = {format: B.FORMAT, version: 1, savedAt: 1,
               data: {history: [rec("a", 1)], jockeys: {}, jockeyNames: [], state: null}};
  assert.strictEqual(B.validate(old).ok, true, "v1 が読めない");
  const m = B.merge({history: [], jockeys: {}, jockeyNames: [], tune: null}, old, {});
  assert.strictEqual(m.history.length, 1);
  assert.strictEqual(m.tune, null);
});

console.log("\n■ 復元（既定は「足す」）");

const CURRENT = {
  history: [rec("a", 100, true), rec("b", 200, false)],
  jockeys: {"武豊":5, "森泰斗":4},
  jockeyNames: ["武豊","森泰斗"],
  state: {now:"いま入力中"}
};

t("いまの記録を消さずに、バックアップにしかない記録を足す", () => {
  const inc = B.build({history:[rec("c", 300, true)], jockeys:{}, jockeyNames:[]}, 0);
  const m = B.merge(CURRENT, inc);
  assert.strictEqual(m.history.length, 3, "件数: " + m.history.length);
  ["a","b","c"].forEach(id =>
    assert.ok(m.history.some(r => r.id === id), id + " が消えた"));
  assert.strictEqual(m.added.history, 1, "足した件数が合わない");
});

t("復元しても、いま入力中のレースは差し替えない", () => {
  const inc = B.build({state:{old:"むかしの入力"}}, 0);
  assert.deepStrictEqual(B.merge(CURRENT, inc).state, CURRENT.state);
  // 明示したときだけ差し替える
  assert.deepStrictEqual(B.merge(CURRENT, inc, {restoreState:true}).state, {old:"むかしの入力"});
});

t("同じ記録は着順が入っている方を残す", () => {
  // 着順を入れたあとにバックアップを取り直していない場合に、着順を失わない
  const inc = B.build({history:[rec("a", 100, false)]}, 0);
  const m = B.merge(CURRENT, inc);
  assert.strictEqual(m.history.length, 2);
  assert.ok(m.history.find(r => r.id === "a").result, "端末側の着順が消えた");

  // 逆向き（バックアップ側にだけ着順がある）でも残す
  const cur2 = {history:[rec("a", 100, false)]};
  const inc2 = B.build({history:[rec("a", 100, true)]}, 0);
  assert.ok(B.merge(cur2, inc2).history[0].result, "バックアップ側の着順が消えた");
});

t("どちらも同条件なら、保存が新しい方を残す", () => {
  const cur = {history:[rec("a", 100, false)]};
  const inc = B.build({history:[rec("a", 500, false)]}, 0);
  assert.strictEqual(B.merge(cur, inc).history[0].savedAt, 500);
});

t("記録は新しい順に並ぶ", () => {
  const inc = B.build({history:[rec("c", 50, false), rec("d", 999, false)]}, 0);
  const m = B.merge(CURRENT, inc);
  const at = m.history.map(r => r.savedAt);
  for(let i=1;i<at.length;i++) assert.ok(at[i-1] >= at[i], "並びが降順でない: " + at.join(","));
});

t("騎手評価は、同じ騎手なら端末の値を残す", () => {
  const inc = B.build({jockeys:{"武豊":1, "川田将雅":5}}, 0);
  const m = B.merge(CURRENT, inc);
  assert.strictEqual(m.jockeys["武豊"], 5, "手でつけた評価が上書きされた");
  assert.strictEqual(m.jockeys["川田将雅"], 5, "バックアップ側の騎手が入っていない");
  assert.strictEqual(m.added.jockeys, 1);
});

t("騎手名の辞書は和集合になる", () => {
  const inc = B.build({jockeyNames:["武豊","小野楓馬"]}, 0);
  const m = B.merge(CURRENT, inc);
  assert.deepStrictEqual(m.jockeyNames, ["武豊","森泰斗","小野楓馬"]);
  assert.strictEqual(m.added.jockeyNames, 1);
});

t("空のバックアップを読み込んでも、いまのデータは変わらない", () => {
  const m = B.merge(CURRENT, B.build({}, 0));
  assert.strictEqual(m.history.length, 2);
  assert.deepStrictEqual(m.jockeys, CURRENT.jockeys);
  assert.deepStrictEqual(m.jockeyNames, CURRENT.jockeyNames);
  assert.deepStrictEqual(m.added, {history:0, jockeys:0, jockeyNames:0});
});

t("空の端末に復元すると、そのまま入る", () => {
  const inc = B.build({history:[rec("a",1,true)], jockeys:{"武豊":5}, jockeyNames:["武豊"]}, 0);
  const m = B.merge({}, inc);
  assert.strictEqual(m.history.length, 1);
  assert.strictEqual(m.jockeys["武豊"], 5);
  assert.deepStrictEqual(m.jockeyNames, ["武豊"]);
});

console.log("\n■ 置き換え");

t("置き換えはバックアップの内容だけになる", () => {
  const inc = B.build({history:[rec("z", 1, false)], jockeys:{"武豊":2}, jockeyNames:["武豊"]}, 0);
  const r = B.replace(inc);
  assert.strictEqual(r.history.length, 1);
  assert.strictEqual(r.history[0].id, "z");
  assert.strictEqual(r.jockeys["武豊"], 2, "バックアップの値になっていない");
  assert.strictEqual(r.added.history, 1);
});

console.log("\n■ 往復");

t("書き出して読み込むと、元どおりになる", () => {
  const data = {
    history: [rec("a", 100, true), rec("b", 200, false)],
    jockeys: {"武豊":5, "森泰斗":4},
    jockeyNames: ["武豊","森泰斗"],
    state: {race:{track:"ooi"}, horses:[{num:1}]}
  };
  const file = JSON.parse(JSON.stringify(B.build(data, 1)));   // ファイル経由を模す
  assert.strictEqual(B.validate(file).ok, true);
  const back = B.replace(file);
  assert.deepStrictEqual(back.history, data.history);
  assert.deepStrictEqual(back.jockeys, data.jockeys);
  assert.deepStrictEqual(back.jockeyNames, data.jockeyNames);
  // 空の端末へ「足す」でも同じ内容になる（並びは新しい順になる）
  const merged = B.merge({}, file, {restoreState:true});
  const byId = list => list.slice().sort((x,y) => x.id < y.id ? -1 : 1);
  assert.deepStrictEqual(byId(merged.history), byId(data.history));
  assert.deepStrictEqual(merged.history.map(r => r.id), ["b","a"], "新しい順になっていない");
  assert.deepStrictEqual(merged.state, data.state);
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
