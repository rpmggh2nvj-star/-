/* 出馬表パーサーの検証。node keiba/test/parse.test.js で実行する。

   注意：実サイトのHTMLをこの環境から取得できないため、ここで使う入力は
   出馬表の代表的な表記パターンを再現したもの。実データでの最終確認は必要。 */
"use strict";
const assert = require("assert");
const P = require("../parse.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}
const find = (hs, n) => hs.find(h => h.num === n);

/* ---- 入力サンプル ---- */

// A: 枠番＋馬番のタブ区切り（中央の出馬表を画面からコピーした形）
const TEXT_JRA = [
  "2回東京8日 11R  サンプルステークス  芝1800m  馬場:良  発走15:40",
  "枠\t馬番\t馬名\t性齢\t斤量\t騎手\t厩舎\t馬体重\t単勝\t人気",
  "1\t1\tハヤテノオージ\t牡3\t56.0\t武豊\t栗東・友道\t480(+2)\t5.8\t3",
  "2\t2\tミドリノカゼ\t牝4\t54.0\t川田将雅\t美浦・国枝\t462(-6)\t28.0\t8",
  "3\t3\tクロガネマル\t牡5\t57.5\t福永祐一\t栗東・矢作\t506(0)\t3.2\t1",
  "4\t4\tシラユキヒメ\t牝4\t54.0\t戸崎圭太\t美浦・堀\t444(+4)\t12.4\t5",
  "5\t5\tタカラブネ\t セ6\t55.0\t横山典弘\t美浦・手塚\t498(-2)\t45.0\t9",
  "6\t6\tアカツキノホシ\t牡4\t56.0\tルメール\t栗東・池江\t470(0)\t8.1\t4",
  "7\t7\tユウヅキノマイ\t牝5\t54.0\t松山弘平\t栗東・中内田\t488(+8)\t19.6\t7",
  "8\t8\tリュウセイオー\t牡4\t57.0\tデムーロ\t美浦・木村\t492(0)\t6.7\t2"
].join("\n");

// B: 馬番のみ・項目の並びが違う南関の出馬表（オッズが斤量より前）
const TEXT_NAR = [
  "大井競馬 第9R  スパーキングナイト  ダート1600m  馬場状態:稍重",
  "馬番 馬名 性齢 単勝 斤量 騎手 馬体重",
  "1 ミナミノヒカリ 牡4 2.4 56.0 御神本訓史 510(+4)",
  "2 シオカゼクイーン 牝5 15.7 54.0 森泰斗 486(-2)",
  "3 オオイノオウジャ 牡6 6.3 57.0 矢野貴之 522(0)",
  "4 ハマカゼボーイ 牡3 52.3 55.0 笹川翼 468(-8)",
  "5 ベイサイドスター 牝4 9.9 54.0 吉原寛人 494(+6)"
].join("\n");

// C: HTMLテーブル
const HTML = `<table class="RaceTable">
<tr><th>枠</th><th>馬番</th><th>馬名</th><th>斤量</th><th>馬体重</th><th>オッズ</th></tr>
<tr><td>1</td><td>1</td><td><a href="/horse/1">カワサキブレイブ</a></td><td>56.0</td><td>480(+2)</td><td>4.5</td></tr>
<tr><td>2</td><td>2</td><td><a href="/horse/2">ウラワスピリット</a></td><td>54.0</td><td>452(-4)</td><td>11.2</td></tr>
<tr><td>3</td><td>3</td><td><a href="/horse/3">フナバシノカゼ</a></td><td>55.0</td><td>500(0)</td><td>7.8</td></tr>
</table>
<p>川崎競馬 1500m ダート 馬場:重</p>`;

console.log("\n■ 中央の出馬表（枠番＋馬番）");

const A = P.parseRacecard(TEXT_JRA);

t("8頭すべて読み取れる", () => {
  assert.strictEqual(A.horses.length, 8, "頭数: " + A.horses.length);
});

t("枠番ではなく馬番を採る", () => {
  assert.deepStrictEqual(A.horses.map(h => h.num), [1,2,3,4,5,6,7,8]);
});

t("馬名が正しい", () => {
  assert.strictEqual(find(A.horses,1).name, "ハヤテノオージ");
  assert.strictEqual(find(A.horses,8).name, "リュウセイオー");
});

t("オッズ・斤量・馬体重増減が正しい", () => {
  const h3 = find(A.horses, 3);
  assert.strictEqual(h3.odds, 3.2, "odds=" + h3.odds);
  assert.strictEqual(h3.kinryo, 57.5, "kinryo=" + h3.kinryo);
  assert.strictEqual(h3.weight, 506, "weight=" + h3.weight);
  assert.strictEqual(h3.wdiff, 0, "wdiff=" + h3.wdiff);
  const h7 = find(A.horses, 7);
  assert.strictEqual(h7.odds, 19.6);
  assert.strictEqual(h7.wdiff, 8);
  const h2 = find(A.horses, 2);
  assert.strictEqual(h2.wdiff, -6);
});

t("性齢が取れる", () => {
  assert.strictEqual(find(A.horses,1).sex, "牡");
  assert.strictEqual(find(A.horses,1).age, 3);
  assert.strictEqual(find(A.horses,2).sex, "牝");
  assert.strictEqual(find(A.horses,5).sex, "セ");
});

t("レース条件（芝1800m・良）を検出する", () => {
  assert.strictEqual(A.race.track, "tokyo", "track=" + A.race.track);
  assert.strictEqual(A.race.surface, "turf", "surface=" + A.race.surface);
  assert.strictEqual(A.race.distance, 1800, "distance=" + A.race.distance);
  assert.strictEqual(A.race.condition, 0, "condition=" + A.race.condition);
  assert.strictEqual(A.race.raceNo, 11, "raceNo=" + A.race.raceNo);
});

console.log("\n■ 南関の出馬表（オッズが斤量より前）");

const B = P.parseRacecard(TEXT_NAR);

t("5頭すべて読み取れる", () => {
  assert.strictEqual(B.horses.length, 5, "頭数: " + B.horses.length);
});

t("並び順が違ってもオッズと斤量を取り違えない", () => {
  const h1 = find(B.horses,1);
  assert.strictEqual(h1.odds, 2.4, "odds=" + h1.odds);
  assert.strictEqual(h1.kinryo, 56.0, "kinryo=" + h1.kinryo);
});

t("オッズが斤量と同じ範囲（52.3倍）でも取り違えない", () => {
  const h4 = find(B.horses,4);
  assert.strictEqual(h4.odds, 52.3, "odds=" + h4.odds + "（斤量と混同している）");
  assert.strictEqual(h4.kinryo, 55.0, "kinryo=" + h4.kinryo);
});

t("大井を検出し、南関なので自動でダートになる", () => {
  assert.strictEqual(B.race.track, "ooi", "track=" + B.race.track);
  assert.strictEqual(B.race.surface, "dirt");
  assert.strictEqual(B.race.distance, 1600);
  assert.strictEqual(B.race.condition, 1, "稍重=1 のはず: " + B.race.condition);
});

console.log("\n■ HTML入力");

const C = P.parseRacecard(HTML);

t("HTMLと判定してタグを除去して読める", () => {
  assert.ok(P.looksLikeHtml(HTML), "HTML判定に失敗");
  assert.strictEqual(C.horses.length, 3, "頭数: " + C.horses.length);
  assert.strictEqual(find(C.horses,1).name, "カワサキブレイブ");
  assert.strictEqual(find(C.horses,2).odds, 11.2);
  assert.strictEqual(find(C.horses,3).wdiff, 0);
});

t("川崎・重馬場を検出する", () => {
  assert.strictEqual(C.race.track, "kawasaki", "track=" + C.race.track);
  assert.strictEqual(C.race.surface, "dirt");
  assert.strictEqual(C.race.condition, 2, "重=2 のはず: " + C.race.condition);
});

console.log("\n■ 異常系と報告");

t("空入力でも落ちず、警告を返す", () => {
  const r = P.parseRacecard("");
  assert.strictEqual(r.horses.length, 0);
  assert.ok(r.warnings.length > 0, "警告がない");
});

t("馬名らしき語があっても馬番がなければ採用しない", () => {
  const r = P.parseRacecard("本日のメインレース サンプルステークス はスプリント戦です");
  assert.strictEqual(r.horses.length, 0, "誤検出: " + JSON.stringify(r.horses.map(h=>h.name)));
});

t("馬番が重複したら片方を捨てて警告する", () => {
  const r = P.parseRacecard("1 アイウエオカ 56.0\n1 カキクケコサ 56.0\n2 サシスセソタ 56.0");
  assert.strictEqual(r.horses.length, 2, "頭数: " + r.horses.length);
  assert.ok(r.warnings.some(w => /重複/.test(w)), "重複の警告がない");
});

t("未取得の項目を必ず警告する", () => {
  const r = P.parseRacecard("1 アイウエオカ\n2 カキクケコサ");
  assert.ok(r.warnings.some(w => /オッズ/.test(w)), "オッズ未取得の警告がない");
  assert.ok(r.warnings.some(w => /近走着順/.test(w)), "既定値のままである旨の注意がない");
});

t("既定値が入っているので、そのまま予想にかけられる", () => {
  const E = require("../engine.js");
  const rows = E.analyze(Object.assign({track:"ooi",surface:"dirt",distance:1600,
                                        condition:1,pace:"mid",budget:5000}, B.race), B.horses);
  assert.strictEqual(rows.length, 5);
  const sum = rows.reduce((a,x)=>a+x.prob,0);
  assert.ok(Math.abs(sum-1) < 1e-9, "確率の合計が " + sum);
});


console.log("\n■ 列方向コピー（スマホで実際にコピーした出馬表）");

// 実際に船橋の出馬表をスマホでコピーしたもの。行ではなく列単位で並ぶ。
const COL = require("fs").readFileSync(__dirname + "/fixture-funabashi.txt", "utf8");
const CO = P.parseRacecard(COL);

t("行ベースでは読めない形でも7頭すべて読み取れる", () => {
  assert.strictEqual(CO.horses.length, 7, "頭数: " + CO.horses.length);
});

t("馬名が正しい順で並ぶ", () => {
  assert.deepStrictEqual(CO.horses.map(h => h.name),
    ["タケデンプリンセス","アマゴ","マッドリボンガール","ミュージシエンヌ",
     "フェアリーランド","エンドステージ","カナーリオ"]);
});

t("オッズ・斤量・性齢・人気が各馬に正しく対応する", () => {
  assert.deepStrictEqual(CO.horses.map(h => h.odds),
    [50.0, 79.9, 2.7, 4.8, 5.3, 2.3, 50.3]);
  assert.deepStrictEqual(CO.horses.map(h => h.kinryo),
    [54, 54, 51, 54, 52, 56, 54]);
  assert.deepStrictEqual(CO.horses.map(h => h.sex + h.age),
    ["牝5","牝7","牝5","牝4","牝7","セ8","牝5"]);
  assert.deepStrictEqual(CO.horses.map(h => h.pop), [5, 7, 2, 3, 4, 1, 6]);
});

t("厩舎欄に他場名があっても競馬場は船橋になる", () => {
  assert.strictEqual(CO.race.track, "funabashi", "track=" + CO.race.track);
});

t("列ずれの検算が通る（人気とオッズの順位が一致）", () => {
  assert.ok(!CO.warnings.some(w => /一致しません/.test(w)),
    "列ずれの警告が出ている: " + CO.warnings.filter(w => /一致しません/.test(w)));
});

t("列がずれていれば検算で気づける", () => {
  // 人気の先頭2つを入れ替えた入力を作り、警告が出ることを確認する。
  // 昇順にすると馬番の列とみなされてしまうため、順列のまま入れ替える。
  const cut = COL.lastIndexOf("50.3") + 4;
  const broken = COL.slice(0, cut) + "\n\n7\n\n5\n\n2\n\n3\n\n4\n\n1\n\n6\n";
  const r = P.parseRacecard(broken);
  assert.strictEqual(r.horses.length, 7, "頭数が変わっている: " + r.horses.length);
  assert.deepStrictEqual(r.horses.map(h => h.pop), [7,5,2,3,4,1,6], "人気の入れ替えが反映されていない");
  assert.ok(r.warnings.some(w => /一致しません/.test(w)),
    "列ずれを検出できていない: " + JSON.stringify(r.warnings));
});

t("馬番の列がないので並び順で1〜7が振られ、その旨を報告する", () => {
  assert.deepStrictEqual(CO.horses.map(h => h.num), [1,2,3,4,5,6,7]);
  assert.ok(CO.warnings.some(w => /馬番の列が見つからなかった/.test(w)),
    "馬番を推定した旨の警告がない");
});

t("行方向の出馬表は今までどおり行として読む（誤判定しない）", () => {
  assert.strictEqual(P.parseRacecard(TEXT_JRA).horses.length, 8);
  assert.strictEqual(P.parseRacecard(TEXT_NAR).horses.length, 5);
  assert.ok(!P.parseRacecard(TEXT_JRA).warnings.some(w => /列ごとに/.test(w)),
    "行方向なのに列として読んでいる");
});


console.log("\n■ 脚質・近走着順・距離/馬場の追加読み取り");

const COL_FULL = [
  "船橋 ダ1600 良馬場",
  "馬名","アイウエオカ","カキクケコサ","サシスセソタ","タチツテトナ",
  "斤量","54.0","55.0","56.0","54.0",
  "脚質","逃","先","差","追",
  "前走","1着","5着","3着","中止",
  "2走前","2着","4着","1着","7着",
  "3走前","3着","6着","2着","取消",
  "オッズ","2.4","15.7","6.3","33.0",
  "人気","1","3","2","4"
].join("\n");
const CF = P.parseRacecard(COL_FULL);

t("列方向：脚質の列を読み取る", () => {
  assert.deepStrictEqual(CF.horses.map(h => h.style),
    ["nige","senko","sashi","oikomi"]);
});

t("列方向：近走着順を前走・2走前・3走前に割り当てる", () => {
  assert.deepStrictEqual(CF.horses.map(h => [h.last1,h.last2,h.last3]),
    [[1,2,3],[5,4,6],[3,1,2],[0,7,0]]);
});

t("中止・取消は出走なし（0）として扱う", () => {
  const h4 = CF.horses[3];
  assert.strictEqual(h4.last1, 0, "中止が0でない: " + h4.last1);
  assert.strictEqual(h4.last3, 0, "取消が0でない: " + h4.last3);
});

t("「ダ1600」「良馬場」の書き方でも距離・馬場を取れる", () => {
  assert.strictEqual(CF.race.distance, 1600, "distance=" + CF.race.distance);
  assert.strictEqual(CF.race.condition, 0, "condition=" + CF.race.condition);
});

t("近走・脚質が入ると情報量が上がり、モデルの評価が効く", () => {
  const E = require("../engine.js");
  const race = Object.assign({surface:"dirt",distance:1600,condition:0,pace:"mid",budget:5000}, CF.race);
  const rows = E.analyze(race, CF.horses);
  assert.ok(rows.infoLevel > 0.6, "情報量が上がっていない: " + rows.infoLevel);
  assert.ok(rows.some(x => Math.abs(x.edge - 1) > 0.05), "市場比が動いていない");
});

const ROW_FULL = [
  "大井 ダート1400m 稍重馬場",
  "1 アイウエオカ 牡4 逃げ 2.4 56.0 480(+2) 1着 2着 3着",
  "2 カキクケコサ 牝5 差し 15.7 54.0 462(-6) 5着 4着 6着",
  "3 サシスセソタ 牡6 追込 6.3 57.0 500(0) 3着 1着 2着"
].join("\n");
const RF = P.parseRacecard(ROW_FULL);

t("行方向でも脚質・近走着順を読み取る", () => {
  assert.strictEqual(RF.horses.length, 3);
  assert.deepStrictEqual(RF.horses.map(h => h.style), ["nige","sashi","oikomi"]);
  assert.deepStrictEqual(RF.horses.map(h => [h.last1,h.last2,h.last3]),
    [[1,2,3],[5,4,6],[3,1,2]]);
  assert.deepStrictEqual(RF.horses.map(h => h.odds), [2.4, 15.7, 6.3]);
  assert.deepStrictEqual(RF.horses.map(h => h.kinryo), [56, 54, 57]);
  assert.strictEqual(RF.race.distance, 1400);
  assert.strictEqual(RF.race.condition, 1);
});

t("脚質が載っていない出馬表では既定値のままにする（誤検出しない）", () => {
  // 船橋の実データには脚質・近走の列がない
  assert.ok(CO.horses.every(h => h.style === "senko"), "脚質を誤検出している");
  assert.ok(CO.horses.every(h => h.last1 === 0), "近走を誤検出している");
});

console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
