/* ============================================================
   Turf Logic — 出馬表パーサー
   ------------------------------------------------------------
   保存したHTML、または画面からコピーしたテキストを読んで
   出走馬の情報を取り出す。

   サイトごとのCSSセレクタには依存しない。表記のパターン
   （馬番・カタカナの馬名・性齢・斤量・馬体重・オッズ）を手がかりに
   拾うため、レイアウトが変わっても壊れにくい。
   取れなかった項目は既定値のままにし、warnings で必ず報告する。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.TurfParse = factory(root.TurfEngine);
})(typeof self !== "undefined" ? self : this, function (ENGINE) {
"use strict";

/* ---------- HTML → テキスト ---------- */
function htmlToText(html){
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div|li|h[1-6]|table|tbody)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/[ 　\t]+/g, "\t")
    .replace(/\n{2,}/g, "\n");
}

function looksLikeHtml(s){
  return /<\s*(html|table|tr|td|div|body|!doctype)\b/i.test(String(s).slice(0, 4000));
}

/* ---------- 全角 → 半角（数字・記号のみ） ---------- */
function normalize(s){
  return String(s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．｡]/g, ".")
    .replace(/[（]/g, "(").replace(/[）]/g, ")")
    .replace(/[－ー−―‐]/g, m => (m === "ー" ? "ー" : "-"))   // 長音符は馬名で使うため残す
    .replace(/[＋]/g, "+")
    .replace(/\r\n?/g, "\n");
}

/* ---------- 競馬場・条件の検出 ---------- */
const COND_MAP = {"良":0, "稍重":1, "稍":1, "重":2, "不良":3};

function detectRace(text){
  const t = normalize(text);
  const out = {};
  const warn = [];

  // 競馬場（エンジンの競馬場名と突き合わせる）
  if(ENGINE){
    const hit = [];
    ENGINE.TRACK_KEYS.forEach(k => {
      const name = ENGINE.TRACKS[k].name;
      const i = t.indexOf(name);
      if(i >= 0) hit.push({k, i, name});
    });
    if(hit.length){
      hit.sort((a, b) => a.i - b.i);
      out.track = hit[0].k;
      out.trackName = hit[0].name;
      if(hit.length > 1) warn.push(`競馬場名が複数見つかりました（${hit.map(h=>h.name).join("・")}）。先頭の「${hit[0].name}」を採用しました。`);
    }
  }

  // 距離
  const dist = t.match(/(\d{3,4})\s*(?:m|メートル)/i);
  if(dist) out.distance = Number(dist[1]);

  // コース種別（南関はダートのみ）
  if(out.track && ENGINE && ENGINE.TRACKS[out.track].org === "nar"){
    out.surface = "dirt";
  }else if(/ダート|ダ\s*\d{3,4}|(?:^|[^ー])ダ(?=\s*\d)/.test(t)){
    out.surface = "dirt";
  }else if(/芝/.test(t)){
    out.surface = "turf";
  }

  // 馬場状態（「馬場」「馬場状態」の近くを優先して見る）
  const condNear = t.match(/馬場(?:状態)?\s*[:：]?\s*(不良|稍重|稍|重|良)/);
  const cond = condNear || t.match(/(?:^|\s)(不良|稍重|良)(?:\s|$)/m);
  if(cond) out.condition = COND_MAP[cond[1]];

  // レース番号
  const rno = t.match(/(?:^|\s)(\d{1,2})\s*R(?:\s|$)/m);
  if(rno) out.raceNo = Number(rno[1]);

  // レース名（〜賞 / 〜ステークス / 〜特別 / 〜記念 など）
  const rname = t.match(/([^\s\t\n]{2,20}(?:ステークス|特別|賞|記念|カップ|杯|S))(?:\s|\t|\n|$)/);
  if(rname) out.name = rname[1];

  return {race: out, warnings: warn};
}

/* ---------- 出走馬の抽出 ---------- */

// 馬名として扱わないカタカナ語（出馬表の見出しやレース名に出るもの）
const NOT_A_NAME = new Set([
  "ダート","オッズ","ペース","レース","コース","タイム","ラップ","パドック","メイン",
  "ハンデ","ジョッキー","サラブレッド","デビュー","ゲート","ブリンカー","マイル",
  "スプリント","ステークス","カップ","トライアル","プレミアム","キロ","センチ",
  "ハナ","アタマ","クビ","スロー","ハイ","フリー","トップ","データ","ランキング",
  "スマート","ネット","アプリ","サイト","ログイン","メニュー","リンク","バナー"
]);

const NAME_RE = /[ァ-ヴ][ァ-ヴー]{2,8}/g;

function parseHorses(text){
  const t = normalize(text);
  const warnings = [];

  // 1) 馬名候補をすべて拾う
  const cands = [];
  let m;
  NAME_RE.lastIndex = 0;
  while((m = NAME_RE.exec(t)) !== null){
    if(NOT_A_NAME.has(m[0])) continue;
    cands.push({name: m[0], start: m.index, end: m.index + m[0].length});
  }
  if(!cands.length){
    return {horses: [], warnings: ["カタカナの馬名が1つも見つかりませんでした。出馬表の部分がコピーできているか確認してください。"]};
  }

  // 2) 各候補の直前から馬番を探す（枠番と並ぶ場合は馬名に近い方＝馬番を採る）
  //    数字と馬名の間に空白以外が挟まる場合は馬番ではない。
  //    これがないと「11R サンプルステークス」のようなレース名を
  //    馬番11の馬として拾ってしまう。
  const GAP_OK = /^[\s　]*(?:番)?[\s　]*$/;
  const found = [];
  const skipped = [];
  cands.forEach((c, i) => {
    const before = t.slice(Math.max(0, c.start - 24), c.start);
    const nm = before.match(/(\d{1,2})([^\d]{0,4})$/);
    const num = nm ? Number(nm[1]) : null;
    if(num === null || num < 1 || num > 18 || !GAP_OK.test(nm[2])){
      skipped.push(c.name);
      return;
    }
    const segEnd = (i + 1 < cands.length) ? cands[i + 1].start : t.length;
    found.push({num, name: c.name, seg: t.slice(c.end, segEnd)});
  });

  if(!found.length){
    return {horses: [],
            warnings: ["馬番付きの行が見つかりませんでした。馬番と馬名が同じ行に並ぶ形でコピーしてください。"]};
  }
  if(skipped.length){
    warnings.push(`馬番が見つからず除外した語: ${skipped.slice(0, 8).join("・")}${skipped.length > 8 ? " ほか" : ""}`);
  }

  // 3) 各馬のセグメントから項目を取り出す
  const horses = [];
  const seenNum = new Set();
  found.forEach(f => {
    if(seenNum.has(f.num)){
      warnings.push(`馬番 ${f.num} が重複したため「${f.name}」を読み飛ばしました。`);
      return;
    }
    seenNum.add(f.num);

    const h = ENGINE ? ENGINE.defaultHorse(f.num) : {num: f.num};
    h.name = f.name;
    h._got = [];
    let seg = f.seg;

    // 馬体重（480(+4) / 480(-6) / 480(0)）— 最も特徴的なので先に取り除く
    const wt = seg.match(/(\d{3})\s*\(\s*([+\-]?\d{1,3}|前計不|計不)\s*\)/);
    if(wt){
      h.weight = Number(wt[1]);
      h.wdiff = /不/.test(wt[2]) ? 0 : Number(wt[2]);
      h._got.push("馬体重");
      seg = seg.replace(wt[0], " ");
    }

    // 性齢（牡3 / 牝4 / セ5）
    const sa = seg.match(/(牡|牝|セン|セ|騸)\s*(\d{1,2})/);
    if(sa){
      h.sex = sa[1] === "騸" ? "セ" : sa[1];
      h.age = Number(sa[2]);
      h._got.push("性齢");
      seg = seg.replace(sa[0], " ");
    }

    // 斤量（47.0〜63.0kg。小数は .0 か .5 のみ＝オッズとの取り違えを防ぐ）
    const kin = seg.match(/(?:^|[^\d.])((?:4[7-9]|5\d|6[0-3])(?:\.[05])?)(?![\d.])/);
    if(kin){
      h.kinryo = Number(kin[1]);
      h._got.push("斤量");
      seg = seg.replace(kin[1], " ");
    }

    // 単勝オッズ（小数点つきの数値を優先。1.0以上）
    const od = seg.match(/(?:^|[^\d.])(\d{1,4}\.\d)(?![\d])/);
    if(od && Number(od[1]) >= 1){
      h.odds = Number(od[1]);
      h._got.push("オッズ");
      seg = seg.replace(od[1], " ");
    }

    // 人気
    const pop = seg.match(/(\d{1,2})\s*番?人気/);
    if(pop){ h.pop = Number(pop[1]); h._got.push("人気"); }

    horses.push(h);
  });

  horses.sort((a, b) => a.num - b.num);

  // 4) 取得状況の要約
  const total = horses.length;
  const gotCount = key => horses.filter(h => h._got.indexOf(key) >= 0).length;
  const missing = [];
  ["オッズ", "斤量", "馬体重"].forEach(k => {
    const g = gotCount(k);
    if(g === 0) missing.push(`${k}（0/${total}頭）`);
    else if(g < total) missing.push(`${k}（${g}/${total}頭のみ）`);
  });
  if(missing.length) warnings.push("読み取れなかった項目があります: " + missing.join("、"));
  warnings.push("近走着順・騎手評価・調教評価・距離/馬場適性・脚質は出馬表から一意に決められないため、既定値のままです。予想前に調整してください。");

  return {horses, warnings};
}

/* ---------- まとめ ---------- */
function parseRacecard(input, opts){
  opts = opts || {};
  const raw = String(input);
  const text = (opts.html === true || (opts.html !== false && looksLikeHtml(raw)))
    ? htmlToText(raw) : raw;

  const r = detectRace(text);
  const h = parseHorses(text);
  return {
    race: r.race,
    horses: h.horses,
    warnings: r.warnings.concat(h.warnings),
    text
  };
}

return {parseRacecard, parseHorses, detectRace, htmlToText, looksLikeHtml, normalize};
});
