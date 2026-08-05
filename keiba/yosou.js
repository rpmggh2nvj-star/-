#!/usr/bin/env node
/* ============================================================
   Turf Logic — 予想CLI
   ------------------------------------------------------------
   保存した出馬表（HTML / テキスト）を読み込んで解析し、
   予想と買い目をターミナルに表示する。
   --out を付ければ、HTMLアプリに読み込めるJSONを書き出す。

   使い方:
     node keiba/yosou.js racecard.html
     node keiba/yosou.js racecard.txt --pace high --budget 10000
     cat racecard.txt | node keiba/yosou.js -
     node keiba/yosou.js racecard.html --out race.json
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const url = require("url");
const E = require("./engine.js");
const P = require("./parse.js");
const PDF = require("./pdftext.js");

/* ---------- PDF ----------
   同梱の pdf.js（keiba/vendor）を読み込む。末尾のexportを
   globalThis への代入に書き換えてあるので、読み込むだけで使える。 */
// pdf.js は読み込み時に描画用のブラウザAPIを参照する。
// テキストを取り出すだけなので、Node では最小限の代替を置けば足りる。
function polyfillForNode(){
  if(typeof globalThis.DOMMatrix === "undefined"){
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init){
        const m = Array.isArray(init) ? init : [1,0,0,1,0,0];
        this.a = m[0]; this.b = m[1]; this.c = m[2];
        this.d = m[3]; this.e = m[4]; this.f = m[5];
      }
      translate(x, y){
        return new globalThis.DOMMatrix([this.a, this.b, this.c, this.d,
                                         this.e + (x || 0), this.f + (y || 0)]);
      }
      scale(sx, sy){
        const y = (sy == null) ? sx : sy;
        return new globalThis.DOMMatrix([this.a * sx, this.b * sx,
                                         this.c * y, this.d * y, this.e, this.f]);
      }
      multiply(){ return new globalThis.DOMMatrix([this.a,this.b,this.c,this.d,this.e,this.f]); }
    };
  }
  if(typeof globalThis.Path2D === "undefined"){
    globalThis.Path2D = class Path2D {};
  }
}

async function pdfTextOf(buf){
  polyfillForNode();
  const load = async f => {
    await import(url.pathToFileURL(path.join(__dirname, "vendor", f)).href);
  };
  // pdf.js は描画用ライブラリが無いと警告を出す。文字を取り出すだけなので黙らせる。
  const warn = console.warn, err = console.error;
  console.warn = console.error = () => {};
  try{
    await load("pdf.worker.mjs");   // 先に読むとWorkerを起こさずメインスレッドで動く
    await load("pdf.mjs");
  } finally {
    console.warn = warn; console.error = err;
  }
  if(!globalThis.pdfjsLib) throw new Error("keiba/vendor の pdf.js を読み込めませんでした。");
  return PDF.pdfToText(new Uint8Array(buf), globalThis.pdfjsLib);
}

function isPdf(buf){
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/* ---------- 表示 ---------- */
const C = process.stdout.isTTY ? {
  r:"\x1b[0m", b:"\x1b[1m", dim:"\x1b[2m",
  green:"\x1b[32m", red:"\x1b[31m", blue:"\x1b[34m", yellow:"\x1b[33m"
} : {r:"",b:"",dim:"",green:"",red:"",blue:"",yellow:""};

// 全角を2幅として数える
function width(s){
  let w = 0;
  for(const ch of String(s)){
    w += /[\x20-\xFF\uFF61-\uFF9F]/.test(ch) ? 1 : 2;   // 半角は1、全角は2
  }
  return w;
}
function padEnd(s, n){ return String(s) + " ".repeat(Math.max(0, n - width(s))); }
function padStart(s, n){ return " ".repeat(Math.max(0, n - width(s))) + String(s); }
const yen = v => v.toLocaleString("ja-JP") + "円";

/* ---------- 引数 ---------- */
function parseArgs(argv){
  const o = {file:null, opts:{}};
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a === "-h" || a === "--help"){ o.opts.help = true; }
    else if(a.startsWith("--")){
      const key = a.slice(2);
      const next = argv[i+1];
      if(next === undefined || next.startsWith("--")) o.opts[key] = true;
      else { o.opts[key] = next; i++; }
    }
    else if(!o.file) o.file = a;
  }
  return o;
}

const HELP = `
Turf Logic 予想CLI

  node keiba/yosou.js <出馬表ファイル> [オプション]
  cat racecard.txt | node keiba/yosou.js -

出馬表は次のいずれかを渡してください。
  ・競馬新聞や出馬表を保存したPDF
  ・ブラウザで開いた出馬表ページを保存したHTML
  ・画面からコピーしたテキスト

オプション
  --track <名>       競馬場（例: 東京 / 大井 / ooi）。未指定なら本文から自動判定
  --surface <turf|dirt|芝|ダート>
  --distance <m>
  --condition <良|稍重|重|不良|0-3>
  --course outer     外回り（新潟・京都・阪神の芝）
  --pace <high|mid|slow|ハイ|平均|スロー>   未指定なら脚質構成から自動判定
  --budget <円>      既定 5000
  --out <file.json>  HTMLアプリに読み込めるJSONを書き出す
  --json             解析結果のJSONだけを標準出力に出す
  --text             入力をHTMLではなくテキストとして扱う

競馬場一覧
  中央: ${E.JRA_KEYS.map(k => E.TRACKS[k].name).join(" ")}
  南関: ${E.NANKAN_KEYS.map(k => E.TRACKS[k].name).join(" ")}
  地方: ${E.CHIHO_KEYS.map(k => E.TRACKS[k].name).join(" ")}
`;

/* ---------- 値の正規化 ---------- */
function resolveTrack(v){
  if(!v || v === true) return null;
  const s = String(v);
  if(E.TRACKS[s]) return s;
  const hit = E.TRACK_KEYS.find(k => E.TRACKS[k].name === s);
  return hit || null;
}
function resolveSurface(v){
  const s = String(v);
  if(/^(turf|芝)$/i.test(s)) return "turf";
  if(/^(dirt|ダート|ダ)$/i.test(s)) return "dirt";
  return null;
}
function resolveCondition(v){
  const s = String(v);
  const m = {"良":0,"稍重":1,"重":2,"不良":3};
  if(s in m) return m[s];
  const n = Number(s);
  return (n >= 0 && n <= 3) ? n : null;
}
function resolvePace(v){
  const s = String(v);
  const m = {"ハイ":"high","平均":"mid","スロー":"slow"};
  if(s in m) return m[s];
  return /^(high|mid|slow)$/.test(s) ? s : null;
}

/* ---------- 本体 ---------- */
async function main(){
  const {file, opts} = parseArgs(process.argv.slice(2));

  if(opts.help || (!file && process.stdin.isTTY)){
    console.log(HELP);
    process.exit(file ? 0 : 1);
  }

  let buf;
  if(file && file !== "-"){
    if(!fs.existsSync(file)){
      console.error(`ファイルが見つかりません: ${file}`);
      process.exit(1);
    }
    buf = fs.readFileSync(file);
  }else{
    buf = fs.readFileSync(0);
  }

  let raw, pdfPages = 0;
  if(isPdf(buf)){
    const r = await pdfTextOf(buf);
    raw = r.text;
    pdfPages = r.pages;
    if(!raw.trim()){
      console.error("\nPDFから文字を取り出せませんでした。");
      console.error("紙面をスキャンした画像だけのPDFの可能性があります（文字情報が入っていません）。\n");
      process.exit(2);
    }
  }else{
    raw = buf.toString("utf8");
  }

  const parsed = P.parseRacecard(raw, {html: (opts.text || pdfPages) ? false : undefined});

  if(!parsed.horses.length){
    console.error(`\n${C.red}出走馬を読み取れませんでした。${C.r}`);
    parsed.warnings.forEach(w => console.error("  - " + w));
    console.error("\n出馬表の表（馬番・馬名・オッズが並ぶ部分）が含まれているか確認してください。\n");
    process.exit(2);
  }

  // レース条件：コマンドライン > 本文からの自動判定 > 既定値
  const race = Object.assign(
    {track:null, surface:"dirt", distance:1600, condition:0, pace:null, budget:5000},
    parsed.race
  );
  if(opts.track)     race.track = resolveTrack(opts.track) || race.track;
  if(opts.surface)   race.surface = resolveSurface(opts.surface) || race.surface;
  if(opts.distance)  race.distance = Number(opts.distance) || race.distance;
  if(opts.condition !== undefined) race.condition = resolveCondition(opts.condition) ?? race.condition;
  if(opts.course === "outer") race.course = "outer";
  if(opts.budget)    race.budget = Number(opts.budget) || race.budget;

  // 芝コースを持たない競馬場はダートに固定する（地方の多くはダートのみ）
  const tk = race.track && E.TRACKS[race.track];
  if(tk && tk.straight.turf == null && !(tk.outer && tk.outer.turf != null)) race.surface = "dirt";

  // ペース：指定がなければ脚質構成から自動判定
  const auto = E.autoPace(parsed.horses);
  race.pace = (opts.pace && resolvePace(opts.pace)) || race.pace || auto.pace;

  const rows = E.analyze(race, parsed.horses);
  // 締切間際にオッズを見るだけで判断できるよう、馬ごとの買い下限を出しておく
  E.fillBreakEven(race, parsed.horses, rows);
  const {bets, value, dropped, grade, upset, spend} = E.buildBets(rows, race.budget);
  const verdict = E.verdictOf(rows);

  /* ---- JSON出力 ---- */
  const payload = {
    generatedBy: "Turf Logic CLI",
    source: file && file !== "-" ? path.basename(file) : "stdin",
    race: race,
    horses: parsed.horses.map(h => {
      const c = Object.assign({}, h); delete c._got; return c;
    }),
    warnings: parsed.warnings
  };

  if(opts.json){
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  if(opts.out && opts.out !== true){
    fs.writeFileSync(opts.out, JSON.stringify(payload, null, 2), "utf8");
  }

  /* ---- 画面出力 ---- */
  const tName = race.track && E.TRACKS[race.track] ? E.TRACKS[race.track].name : "（競馬場不明）";
  const org = race.track && E.TRACKS[race.track]
    ? ({jra:"中央", nankan:"南関", chiho:"地方"})[E.TRACKS[race.track].area] : "-";
  const sName = race.surface === "turf" ? "芝" : "ダート";
  const cName = ["良","稍重","重","不良"][race.condition] || "良";
  const pName = {high:"ハイ", mid:"平均", slow:"スロー"}[race.pace];

  console.log("");
  console.log(`${C.b}${C.green}━━━ Turf Logic 予想 ━━━${C.r}`);
  console.log(`${C.dim}${org}${C.r} ${C.b}${tName}${C.r} ${sName}${race.distance}m` +
              `${race.course === "outer" ? "（外回り）" : ""} ・ 馬場${cName} ・ 想定${pName}ペース ・ ${rows.length}頭` +
              (race.name ? ` ・ ${race.name}` : "") +
              (race.raceNo ? ` ・ ${race.raceNo}R` : ""));
  if(pdfPages) console.log(`${C.dim}  PDF ${pdfPages}ページから読み取り${C.r}`);
  if(!opts.pace) console.log(`${C.dim}  ペースは逃げ${auto.nige}頭・先行${auto.senko}頭から自動判定${C.r}`);
  console.log("");
  // 情報量：既定値のままの項目が多いと、モデルは市場（オッズ）に委ねる
  const info = rows.infoLevel;
  const infoPct = Math.round(info * 100);
  if(info < 0.35){
    console.log(`${C.yellow}情報量 ${infoPct}%${C.r} ${C.dim}— 判断材料が乏しいため、ほぼオッズ通りの評価になっています。` +
                `近走着順・脚質・騎手評価を入れると独自の評価が出ます。${C.r}`);
  }else{
    console.log(`${C.dim}情報量 ${infoPct}% ／ 市場の重み ${(rows.marketWeight*100).toFixed(0)}%${C.r}`);
  }
  console.log("");
  // このレースを買うべきかどうかを最初に出す
  const gcol = grade.grade === "skip" ? C.red : grade.grade === "strong" ? C.green : C.yellow;
  console.log(`${C.b}${gcol}【${grade.title}】${C.r} ${grade.reason}`);
  console.log(`${C.dim}  ${grade.advice}${C.r}`);
  console.log("");
  // 荒れ度と、その場合の買い方
  const ucol = upset.level === "high" ? C.red : upset.level === "mid" ? C.yellow : C.green;
  console.log(`${C.b}${ucol}荒れ度 ${upset.label}（${upset.score}/100）${C.r}`);
  upset.reasons.forEach(x => console.log(`${C.dim}  - ${x}${C.r}`));
  console.log(`${C.dim}  この荒れ度での買い方:${C.r}`);
  upset.advice.forEach(x => console.log(`${C.dim}    ・${x}${C.r}`));
  console.log("");
  console.log(`${C.b}${verdict.title}${C.r}  ${C.dim}${verdict.sub}${C.r}`);
  if(value){
    console.log(`${C.red}妙味${C.r} ${value.h.num}番 ${value.h.name}` +
                `（市場比 ${value.edge.toFixed(2)} 倍・単勝期待値 ${value.ev.toFixed(2)}）`);
  }
  console.log("");

  // ランキング
  const head = `${padStart("印",4)} ${padStart("馬番",4)} ${padEnd("馬名",20)} ` +
               `${padStart("指数",6)} ${padStart("オッズ",7)} ${padStart("勝率",7)} ` +
               `${padStart("期待値",7)} ${padStart("買い下限",8)}  脚質`;
  console.log(C.dim + head + C.r);
  console.log(C.dim + "─".repeat(45) + C.r);

  rows.forEach((x, i) => {
    const mark = i < E.MARKS.length ? E.MARKS[i] : String(i + 1);
    let tag = "";
    if(E.isValue(x)) tag = ` ${C.red}妙味${C.r}`;
    else if(E.isOverbet(x)) tag = ` ${C.blue}過剰人気${C.r}`;
    const line =
      `${padStart(mark,4)} ${padStart(x.h.num,4)} ${padEnd(x.h.name || "（不明）",20)} ` +
      `${padStart(x.score.toFixed(1),6)} ${padStart(x.h.odds.toFixed(1),7)} ` +
      `${padStart((x.prob*100).toFixed(1)+"%",7)} ${padStart(x.ev.toFixed(2),7)} ` +
      `${padStart(x.minOdds == null ? "—" : x.minOdds + "倍〜", 8)}  ${E.STYLE_LABEL[x.h.style]}`;
    console.log((i === 0 ? C.b : "") + line + C.r + tag);
  });

  // 買い目
  console.log("");
  if(!bets.length){
    console.log(`${C.b}${C.red}推奨買い目 なし${C.r} ${C.dim}このレースは見送りです（予算 ${yen(race.budget)} は使いません）${C.r}`);
  }else{
    const spent = bets.reduce((s, x) => s + x.total, 0);
    console.log(`${C.b}${C.green}推奨買い目${C.r} ${C.dim}予算 ${yen(race.budget)} / 投入 ${yen(spend)} / 使用 ${yen(spent)}${C.r}`);
    bets.forEach(b => {
      console.log(`  ${C.b}${padEnd(b.name, 18)}${C.r}${C.dim}${b.combos.length}点 × ${yen(b.unit)} = ${yen(b.total)}${C.r}`);
      const ev = b.evKnown != null
        ? `期待値 ${b.evKnown.toFixed(2)}（オッズが分かっているので計算済み）`
        : `必要オッズ 平均 ${b.needOdds.toFixed(1)}倍 以上`;
      console.log(`    ${C.dim}的中 ${(b.hit*100).toFixed(1)}% ／ ${ev}${C.r}`);
      /* 1点ごとの必要オッズ。どの1点を外すべきかはここで決まる。
         1点しかない券種では出さない。単勝は上の「買い下限」の方が正しく
         （オッズが動けば推定勝率も動くことを織り込んである）、
         2つ並べると食い違って見えるため。 */
      (b.points && b.points.length > 1 ? b.points : []).forEach(pt => {
        console.log(`      ${padEnd(pt.combo, 12)}${C.dim}的中 ${padStart((pt.hit*100).toFixed(1)+"%",6)}` +
                    ` ／ ${padStart(pt.needOdds.toFixed(1)+"倍〜", 9)}${C.r}`);
      });
    });
    if(dropped && dropped.length){
      console.log(`  ${C.dim}（予算内に収めるため除外: ${dropped.join("・")}）${C.r}`);
    }
    console.log(`  ${C.dim}馬連・ワイド・三連複はオッズを入力していないため期待値を計算できません。`);
    console.log(`  ${C.dim}実際のオッズが1点ごとの必要オッズを下回る点は、その点だけ外してください。${C.r}`);
  }

  // 警告
  if(parsed.warnings.length){
    console.log("");
    console.log(`${C.yellow}確認してください${C.r}`);
    parsed.warnings.forEach(w => console.log(`  - ${w}`));
  }
  if(opts.out && opts.out !== true){
    console.log("");
    console.log(`${C.dim}JSONを書き出しました: ${opts.out}（HTMLアプリの「JSON読込」から取り込めます）${C.r}`);
  }

  console.log("");
  console.log(`${C.dim}※ 指数・推定勝率は入力値をもとにした簡易モデルの計算結果です。的中を保証するものではありません。${C.r}`);
  console.log("");
}

main().catch(e => { console.error("\nエラー: " + (e && e.message ? e.message : e) + "\n"); process.exit(1); });
