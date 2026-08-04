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

  console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
})().catch(e => { console.error("実行エラー:", e.message); process.exit(1); });
