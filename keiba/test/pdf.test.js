/* PDF読み取りの検証。node keiba/test/pdf.test.js で実行する。

   fixture-card.pdf は、出馬表のHTMLをブラウザの「PDFで保存」で
   出力したもの。スマホでPDF保存した場合と同じ作られ方をしている。 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const url = require("url");
const PDF = require("../pdftext.js");
const P = require("../parse.js");
const E = require("../engine.js");

let pass = 0;
function t(name, fn){
  try { fn(); pass++; console.log("  ok   " + name); }
  catch(e){ console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

console.log("\n■ 座標からの行復元（PDF不要）");

// pdf.js が返す形の要素を組み立てる
const item = (x, y, s) => ({str: s, height: 10, transform: [10,0,0,10,x,y]});

t("同じ高さの要素を1行にまとめ、左から右へ並べる", () => {
  const items = [
    item(200, 500, "3着"), item(10, 500, "1"), item(60, 500, "アイウエオカ"),
    item(10, 480, "2"),    item(60, 480, "カキクケコサ"), item(200, 480, "5着")
  ];
  assert.strictEqual(PDF.itemsToLines(items),
    "1\tアイウエオカ\t3着\n2\tカキクケコサ\t5着");
});

t("わずかな縦ずれは同じ行として扱う", () => {
  const items = [item(10, 500, "1"), item(60, 502, "アイウエオカ"), item(200, 499, "3着")];
  assert.strictEqual(PDF.itemsToLines(items).split("\n").length, 1,
    "1行にまとまっていない: " + JSON.stringify(PDF.itemsToLines(items)));
});

t("離れた行は別の行になり、上から順に並ぶ", () => {
  const items = [item(10, 400, "下"), item(10, 500, "上"), item(10, 450, "中")];
  assert.strictEqual(PDF.itemsToLines(items), "上\n中\n下");
});

t("空文字だけの要素は無視する", () => {
  assert.strictEqual(PDF.itemsToLines([item(10,500," "), item(20,500,"")]), "");
  assert.strictEqual(PDF.itemsToLines([]), "");
});

console.log("\n■ 実際のPDFからの読み取り");

// Node で pdf.js を動かすための最小限の代替（描画は使わない）
function polyfill(){
  if(typeof globalThis.DOMMatrix === "undefined"){
    globalThis.DOMMatrix = class { constructor(m){ const a = Array.isArray(m)?m:[1,0,0,1,0,0];
      this.a=a[0];this.b=a[1];this.c=a[2];this.d=a[3];this.e=a[4];this.f=a[5]; }
      translate(){ return this; } scale(){ return this; } multiply(){ return this; } };
  }
  if(typeof globalThis.Path2D === "undefined") globalThis.Path2D = class {};
}

(async () => {
  polyfill();
  const warn = console.warn, err = console.error;
  console.warn = console.error = () => {};
  try{
    await import(url.pathToFileURL(path.join(__dirname, "../vendor/pdf.worker.mjs")).href);
    await import(url.pathToFileURL(path.join(__dirname, "../vendor/pdf.mjs")).href);
  } finally { console.warn = warn; console.error = err; }

  const buf = fs.readFileSync(path.join(__dirname, "fixture-card.pdf"));
  const r = await PDF.pdfToText(new Uint8Array(buf), globalThis.pdfjsLib);

  t("PDFから文字を取り出せる", () => {
    assert.strictEqual(r.pages, 1, "ページ数: " + r.pages);
    assert.ok(r.text.includes("タケデンプリンセス"), "馬名が含まれていない");
    assert.ok(r.text.includes("船橋"), "競馬場名が含まれていない");
  });

  const parsed = P.parseRacecard(r.text, {html:false});

  t("7頭すべて読み取れる", () => {
    assert.strictEqual(parsed.horses.length, 7, "頭数: " + parsed.horses.length);
  });

  t("馬名・オッズ・斤量・馬体重が正しい", () => {
    assert.deepStrictEqual(parsed.horses.map(h => h.name),
      ["タケデンプリンセス","アマゴ","マッドリボンガール","ミュージシエンヌ",
       "フェアリーランド","エンドステージ","カナーリオ"]);
    assert.deepStrictEqual(parsed.horses.map(h => h.odds),
      [50.0, 79.9, 2.7, 4.8, 5.3, 2.3, 50.3]);
    assert.deepStrictEqual(parsed.horses.map(h => h.kinryo), [54,54,51,54,52,56,54]);
    assert.deepStrictEqual(parsed.horses.map(h => h.wdiff), [2,-6,0,4,-2,0,8]);
  });

  t("脚質と近走着順も読み取れる", () => {
    assert.deepStrictEqual(parsed.horses.map(h => h.style),
      ["nige","sashi","senko","sashi","oikomi","nige","senko"]);
    assert.deepStrictEqual(parsed.horses.map(h => [h.last1,h.last2,h.last3]),
      [[3,5,2],[8,7,9],[1,2,1],[2,4,3],[4,3,6],[1,1,2],[0,6,8]]);
  });

  t("「中止」を飛ばさず、着順がずれない", () => {
    // 7番は 中止 → 6着 → 8着。中止を無視すると [6,8,0] にずれる
    const h7 = parsed.horses[6];
    assert.deepStrictEqual([h7.last1, h7.last2, h7.last3], [0, 6, 8],
      `カナーリオの近走が ${[h7.last1,h7.last2,h7.last3]}`);
  });

  t("レース条件（船橋・1600m・良）を検出する", () => {
    assert.strictEqual(parsed.race.track, "funabashi");
    assert.strictEqual(parsed.race.distance, 1600);
    assert.strictEqual(parsed.race.condition, 0);
  });

  t("そのまま予想でき、材料が揃うので市場比が動く", () => {
    const race = Object.assign({surface:"dirt",pace:"mid",budget:5000}, parsed.race);
    const rows = E.analyze(race, parsed.horses);
    assert.ok(rows.infoLevel > 0.6, "情報量が低い: " + rows.infoLevel);
    assert.ok(rows.some(x => Math.abs(x.edge - 1) > 0.1), "市場比が動いていない");
    assert.ok(Math.abs(rows.reduce((a,x)=>a+x.prob,0) - 1) < 1e-9);
  });


  /* ---- netkeiba の馬柱形式（実物） ----
     このPDFと同じレースの出馬表を別途コピーしたものが
     fixture-funabashi.txt にあり、そちらの値を正解として検証する。 */
  const nkBuf = fs.readFileSync(path.join(__dirname, "fixture-netkeiba.pdf"));
  const nk = await PDF.pdfToText(new Uint8Array(nkBuf), globalThis.pdfjsLib);
  const NK = P.parseRacecard(nk.text, {html:false});

  console.log("\n■ netkeiba馬柱形式（実物のPDF）");

  t("馬柱形式として認識し、7頭すべて読み取る", () => {
    assert.ok(NK.warnings.some(w => /馬柱/.test(w)), "馬柱形式として認識していない");
    assert.strictEqual(NK.horses.length, 7, "頭数: " + NK.horses.length);
  });

  t("父名・母名・前走相手を馬名と取り違えない", () => {
    assert.deepStrictEqual(NK.horses.map(h => h.name),
      ["タケデンプリンセス","アマゴ","マッドリボンガール","ミュージシエンヌ",
       "フェアリーランド","エンドステージ","カナーリオ"]);
  });

  t("オッズと人気が正しい", () => {
    assert.deepStrictEqual(NK.horses.map(h => h.odds),
      [50.0, 79.9, 2.7, 4.8, 5.3, 2.3, 50.3]);
    assert.deepStrictEqual(NK.horses.map(h => h.pop), [5, 7, 2, 3, 4, 1, 6]);
  });

  t("斤量が正しい（▲△の減量記号を除いて数値化）", () => {
    assert.deepStrictEqual(NK.horses.map(h => h.kinryo), [54, 54, 51, 54, 52, 56, 54]);
  });

  t("脚質が正しい", () => {
    assert.deepStrictEqual(NK.horses.map(h => h.style),
      ["oikomi","sashi","sashi","sashi","senko","sashi","oikomi"]);
  });

  t("近走着順が正しい", () => {
    assert.deepStrictEqual(NK.horses.map(h => [h.last1,h.last2,h.last3]),
      [[6,12,12],[7,6,6],[1,2,6],[3,2,3],[2,5,6],[1,3,1],[7,7,11]]);
  });

  t("性齢と騎手名が取れる", () => {
    assert.deepStrictEqual(NK.horses.map(h => h.sex + h.age),
      ["牝5","牝7","牝5","牝4","牝7","セ8","牝5"]);
    assert.ok(NK.horses.every(h => h.jockeyName), "騎手名が取れていない馬がある");
  });

  t("レース条件（船橋・ダート1200m）を検出する", () => {
    assert.strictEqual(NK.race.track, "funabashi");
    assert.strictEqual(NK.race.surface, "dirt");
    assert.strictEqual(NK.race.distance, 1200);
  });

  t("過去走のレース名・R番号を今回のものと取り違えない", () => {
    assert.strictEqual(NK.race.name, undefined, "過去走のレース名を拾っている: " + NK.race.name);
    assert.strictEqual(NK.race.raceNo, undefined, "過去走のR番号を拾っている: " + NK.race.raceNo);
  });

  t("過去走から馬場適性・距離適性を推定する", () => {
    assert.ok(NK.horses.every(h => h.baba >= 0 && h.baba <= 3), "馬場適性が範囲外");
    assert.ok(NK.horses.every(h => h.dist >= 0 && h.dist <= 3), "距離適性が範囲外");
    assert.ok(NK.horses.some(h => h.baba !== 2), "馬場適性が全馬既定値のまま");
  });

  t("材料が揃うので、そのまま実用的な予想になる", () => {
    const race = Object.assign({pace:"mid", condition:0, budget:5000}, NK.race);
    const rows = E.analyze(race, NK.horses);
    assert.ok(rows.infoLevel > 0.85, "情報量が低い: " + rows.infoLevel);
    assert.ok(Math.abs(rows.reduce((a,x)=>a+x.prob,0) - 1) < 1e-9);
  });


  t("今回の馬体重が載っていなければ拾わない（前走の値と混同しない）", () => {
    // このPDFは発表前なので今回の馬体重はない。
    // D行には前走の「486kg (+11)」があるが、それを今回の値にしてはいけない。
    assert.ok(NK.horses.every(h => !h._got || h._got.indexOf("馬体重") < 0),
      "前走の馬体重を今回の値として拾っている");
    assert.ok(NK.horses.every(h => h.wdiff === 0), "馬体重増減が0でない");
  });

  t("紙面の申告頭数と読み取り数が食い違えば警告する", () => {
    // 1頭ぶんのブロックから馬名行を壊して、読み取り数を減らす
    const broken = nk.text.replace("マッドリボンガール\t", "\t");
    const r = P.parseRacecard(broken, {html:false});
    assert.ok(r.horses.length < 7, "テスト入力の細工が効いていない: " + r.horses.length);
    assert.ok(r.warnings.some(w => /読み取り漏れ/.test(w)),
      "頭数の食い違いを警告していない: " + JSON.stringify(r.warnings));
  });

  t("行の役割を位置ではなく中身で見分ける（余分な行が入ってもずれない）", () => {
    // ブロックの間に余計な行が入っても読めること
    const padded = nk.text.split("\n").map(l => l + "\n（広告）").join("\n");
    const r = P.parseRacecard(padded, {html:false});
    assert.strictEqual(r.horses.length, 7, "頭数: " + r.horses.length);
    assert.deepStrictEqual(r.horses.map(h => h.odds),
      [50.0, 79.9, 2.7, 4.8, 5.3, 2.3, 50.3]);
  });


  /* ---- 門別（地方競馬・7行ブロックの別形式） ---- */
  const mbBuf = fs.readFileSync(path.join(__dirname, "fixture-monbetsu.pdf"));
  const mb = await PDF.pdfToText(new Uint8Array(mbBuf), globalThis.pdfjsLib);
  const MB = P.parseRacecard(mb.text, {html:false});

  console.log("\n■ 門別（ブロックの行構成が違うPDF）");

  t("1頭あたりの行数が違っても7頭すべて読み取る", () => {
    // このPDFはクラス欄が別行になっており、船橋のPDFより1行多い
    assert.strictEqual(MB.horses.length, 7, "頭数: " + MB.horses.length);
  });

  t("馬名・オッズ・斤量・脚質・近走が正しい", () => {
    assert.deepStrictEqual(MB.horses.map(h => h.name),
      ["マナモアナ","ポポロン","ナイトスパイア","グレートシューター",
       "アルマロザリオ","スウィンドル","ヨシノアヴァンセ"]);
    assert.deepStrictEqual(MB.horses.map(h => h.odds),
      [2.2, 43.4, 6.6, 317.4, 63.0, 2.4, 5.0]);
    assert.deepStrictEqual(MB.horses.map(h => h.kinryo), [55, 52, 54, 57, 55, 57, 55]);
    assert.deepStrictEqual(MB.horses.map(h => h.style),
      ["sashi","sashi","sashi","sashi","sashi","sashi","senko"]);
    assert.deepStrictEqual(MB.horses[0].last1, 2);
    assert.deepStrictEqual(MB.horses[6].last1, 4);
  });

  t("地方競馬場（門別）を認識する", () => {
    assert.strictEqual(MB.race.track, "monbetsu", "track=" + MB.race.track);
    assert.strictEqual(E.TRACKS.monbetsu.area, "chiho");
    assert.strictEqual(MB.race.distance, 1200);
    assert.strictEqual(MB.race.surface, "dirt");
  });

  t("過去走の馬体重を今回の値として取り込まない", () => {
    // D行には「482kg (-6)」など過去4走ぶんの馬体重が並ぶ。
    // 過去走の数と同数なので、今回の発表値は載っていない。
    assert.ok(MB.horses.every(h => h.wdiff === 0),
      "過去走の馬体重増減を今回の値にしている: " + JSON.stringify(MB.horses.map(h=>h.wdiff)));
  });

  t("極端な人気薄に妙味を付けない", () => {
    const rows = E.analyze(Object.assign({pace:"mid", condition:0, budget:5000}, MB.race), MB.horses);
    const ls = rows.find(x => x.h.odds === 317.4);
    assert.ok(!E.isValue(ls), `317倍に妙味（市場比 ${ls.edge.toFixed(2)}）`);
  });

  console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
})().catch(e => { console.error("実行エラー:", e.message); process.exit(1); });
