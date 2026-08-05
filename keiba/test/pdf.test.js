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


  /* ---- 門別10R（過去走のレース名がカタカナ＋出走取消あり） ---- */
  const m10Buf = fs.readFileSync(path.join(__dirname, "fixture-monbetsu10r.pdf"));
  const m10 = await PDF.pdfToText(new Uint8Array(m10Buf), globalThis.pdfjsLib);
  const M10 = P.parseRacecard(m10.text, {html:false});

  console.log("\n■ 門別10R（レース名が馬名と紛らわしいPDF）");

  t("レース名の行を馬名として拾わない", () => {
    /* このPDFの過去走レース名は「ロードカナロア賞」。紙面で「ロードカナ」に
       切れるため、カタカナの馬名と字面で区別できない。5頭ぶんが同じ
       「ロードカナ」になっていた。馬名行は父名行のすぐ下、で判別する。 */
    assert.deepStrictEqual(M10.horses.map(h => h.name),
      ["リアルガー","アドルナティック","カツノトキメキ","ゲームアップロード",
       "エイイチ","ワチュゴナドゥ","ライルアケカイ","ミソタロ","ファーマドール"]);
  });

  t("出走取消・除外の馬を取消として読み取る", () => {
    const scr = M10.horses.filter(h => h.scratched);
    assert.strictEqual(scr.length, 1, "取消頭数: " + scr.length);
    assert.strictEqual(scr[0].num, 5);
    assert.strictEqual(scr[0].name, "エイイチ");
    assert.ok(M10.warnings.some(w => /出走取消・除外として読み取りました/.test(w)),
      "取消の注意が出ていない");
  });

  t("取消馬は予想の対象から外れる", () => {
    const rows = E.analyze(Object.assign({pace:"mid", condition:0, budget:5000}, M10.race), M10.horses);
    assert.strictEqual(rows.length, 8, "予想対象: " + rows.length);
    assert.ok(!rows.some(x => x.h.num === 5), "取消馬が予想に残っている");
    const sum = rows.reduce((a, x) => a + x.prob, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, "勝率の合計が1でない: " + sum);
  });

  t("オッズ・斤量・脚質・近走着順を出走馬ぶん読み取る", () => {
    const live = M10.horses.filter(h => !h.scratched);
    assert.deepStrictEqual(live.map(h => h.odds),
      [9.0, 11.8, 6.8, 5.2, 9.2, 2.7, 8.3, 7.9]);
    assert.deepStrictEqual(live.map(h => h.kinryo), [57, 57, 56, 57, 57, 57, 58, 55]);
    assert.deepStrictEqual(live.map(h => h.style),
      ["sashi","oikomi","sashi","sashi","sashi","sashi","senko","sashi"]);
    // 前走・2走前・3走前（馬名行に前走から順に並ぶ）
    assert.deepStrictEqual(M10.horses[0].last1, 6);
    assert.deepStrictEqual(M10.horses[3].last1, 6);
    assert.deepStrictEqual(M10.horses[7].last1, 2);
  });

  t("紙面で切れた騎手名を、過去走の欄の長い表記に直す", () => {
    /* 今回の騎手欄は幅が狭く「小野楓馬」が「小野楓」で切れる。
       切れたままだと同じ騎手が別人として記憶され、評価が引き継がれない。 */
    const jk = M10.horses.map(h => h.jockeyName);
    assert.deepStrictEqual(jk,
      ["小野楓馬","阿部龍","宮内勇樹","桑村真明","服部茂史",
       "岩橋勇二","石川倭","近藤翔月","落合玄"]);
    assert.ok(M10.warnings.some(w => /騎手名が紙面で切れていた/.test(w)),
      "直したことを報告していない");
  });

  t("伸ばす先が2つ以上ある名前は切れたまま残す", () => {
    // 落合玄 はこの紙面の過去走に長い表記が無いので、勝手に決めない
    assert.strictEqual(M10.horses[8].jockeyName, "落合玄");
    const pool = new Set(["落合玄太", "落合玄一"]);
    const hs = [{jockeyName:"落合玄"}];
    assert.strictEqual(P.expandJockeyNames(hs, pool).grown, 0, "候補が2つあるのに直している");
    assert.strictEqual(hs[0].jockeyName, "落合玄");
    // 候補が1つなら直す
    const hs2 = [{jockeyName:"落合玄"}];
    assert.strictEqual(P.expandJockeyNames(hs2, new Set(["落合玄太"])).grown, 1);
    assert.strictEqual(hs2[0].jockeyName, "落合玄太");
  });

  t("今回の馬体重が未発表なら、前走の値を目安として渡す", () => {
    const live = M10.horses.filter(h => !h.scratched);
    assert.ok(live.every(h => !h.weight), "未発表なのに今回の馬体重を入れている");
    assert.ok(live.every(h => h.wdiff === 0), "増減を入れている");
    assert.deepStrictEqual(M10.horses.map(h => h.prevWeight),
      [502, 468, 466, 540, 494, 510, 490, 484, 465]);
    // 案内の頭数は出走馬ぶん（取消の1頭は数えない）
    assert.ok(M10.warnings.some(w => /前走の馬体重（8頭ぶん）/.test(w)),
      "前走の値を出している旨の案内がない: " + JSON.stringify(M10.warnings));
  });

  t("過去走が除外でも近走着順がずれない", () => {
    // 3番カツノトキメキの4走前は「除」。前3走は 6・4・1。
    const h = M10.horses.find(x => x.num === 3);
    assert.deepStrictEqual([h.last1, h.last2, h.last3], [6, 4, 1]);
  });


  /* ---- 盛岡12R（印の欄が無い・外国産馬・「々」を含む騎手名） ---- */
  const mkBuf = fs.readFileSync(path.join(__dirname, "fixture-morioka12r.pdf"));
  const mk = await PDF.pdfToText(new Uint8Array(mkBuf), globalThis.pdfjsLib);
  const MK = P.parseRacecard(mk.text, {html:false});

  console.log("\n■ 盛岡12R（騎手名が取れなかったPDF）");

  t("12頭すべて読み取り、全頭の騎手名が入る", () => {
    assert.strictEqual(MK.horses.length, 12, "頭数: " + MK.horses.length);
    const missing = MK.horses.filter(h => !h.jockeyName).map(h => h.num);
    assert.deepStrictEqual(missing, [], "騎手名が無い馬番: " + missing.join(","));
  });

  t("母名がローマ字の外国産馬でも騎手名を拾う", () => {
    // 3番の母名は「Sea Chanter (War Chant)」、10番は「Red Hot Tweet (Heatseeker)」。
    // カタカナ限定で母名行を判定していたため、この2頭だけ騎手が空だった。
    assert.strictEqual(MK.horses[2].jockeyName, "高松亮");
    assert.strictEqual(MK.horses[9].jockeyName, "大坪慎");
  });

  t("「々」を含む騎手名を人名として扱う", () => {
    // 「佐々木」の々は漢字の範囲(一-龥)に入らないため、人名判定から漏れていた
    assert.strictEqual(MK.horses[8].jockeyName, "佐々木志");
  });

  t("印の欄が無い紙面でも馬番と騎手がずれない", () => {
    // この紙面のアンカー行は「枠 馬番 厩舎…」で、印（--）の欄が無い
    assert.deepStrictEqual(MK.horses.map(h => h.num), [1,2,3,4,5,6,7,8,9,10,11,12]);
    assert.deepStrictEqual(MK.horses.map(h => h.jockeyName),
      ["岩本怜","小林凌","高松亮","山本聡","山本政聡","山本聡",
       "鈴木祐","塚本涼","佐々木志","大坪慎","関本玲","高橋悠里"]);
  });

  t("候補が複数ある切れた騎手名は直さず、はっきり報告する", () => {
    // 「山本聡」は山本聡紀にも山本聡哉にも当てはまる。別人にしない。
    assert.ok(MK.warnings.some(w => /候補が複数あるためそのままにしました/.test(w) &&
                                    /山本聡/.test(w)),
      "候補が複数ある旨の警告が無い: " + JSON.stringify(MK.warnings));
  });

  t("盛岡（芝のある地方競馬場）とダート1000mを認識する", () => {
    assert.strictEqual(MK.race.track, "morioka");
    assert.strictEqual(MK.race.surface, "dirt");
    assert.strictEqual(MK.race.distance, 1000);
  });

  t("オッズ・斤量・脚質・近走も12頭ぶん揃う", () => {
    assert.deepStrictEqual(MK.horses.map(h => h.odds),
      [82.7, 18.2, 11.1, 1.4, 5.3, 12.2, 43.3, 128.5, 74.9, 179.2, 27.3, 26.3]);
    assert.ok(MK.horses.every(h => h.kinryo >= 54 && h.kinryo <= 58));
    assert.ok(MK.horses.every(h => h.last1 > 0), "近走着順が取れていない馬がある");
    const rows = E.analyze(Object.assign({pace:"mid", condition:0, budget:5000}, MK.race), MK.horses);
    assert.strictEqual(rows.length, 12);
    assert.ok(Math.abs(rows.reduce((a,x)=>a+x.prob,0) - 1) < 1e-9);
  });

  console.log(`\n${pass} 件成功` + (process.exitCode ? "（失敗あり）" : "") + "\n");
})().catch(e => { console.error("実行エラー:", e.message); process.exit(1); });
