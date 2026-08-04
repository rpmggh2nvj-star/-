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

  // 距離（「ダート1600m」「ダ1600」「芝1200」いずれの書き方でも拾う）
  const dist = t.match(/(\d{3,4})\s*(?:m|メートル)/i)
            || t.match(/(?:芝|ダート|ダ)\s*(\d{3,4})(?!\d)/);
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
  const cond = t.match(/馬場(?:状態)?\s*[:：]?\s*(不良|稍重|稍|重|良)/)
            || t.match(/(不良|稍重|重|良)\s*馬場/)
            || t.match(/(?:^|\s)(不良|稍重|良)(?:\s|$)/m);
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
const NAME_ONE = /^[ァ-ヴ][ァ-ヴー]{2,8}$/;

// 脚質の表記ゆれ。サイトによって1文字だったり語だったりする。
const STYLE_TOKEN = {
  "逃":"nige", "逃げ":"nige",
  "先":"senko", "先行":"senko", "自在":"senko",
  "差":"sashi", "差し":"sashi", "マクリ":"sashi", "捲り":"sashi",
  "追":"oikomi", "追込":"oikomi", "追い込み":"oikomi"
};
const STYLE_RE_ONE = /^(?:逃げ|先行|差し|追込|追い込み|自在|マクリ|捲り|逃|先|差|追)$/;

// 着順の表記。取消・中止などは「出走なし（0）」として扱う。
const CHAKU_RE_ONE = /^(?:\d{1,2}着|中止|取消|除外|失格|再審|[-－―])$/;
function chakuValue(s){
  const m = String(s).match(/^(\d{1,2})着$/);
  return m ? Number(m[1]) : 0;
}

// 「480 (+2)」「牝 5」のように離れて並ぶことがあるので、先につなげておく
function glue(t){
  return t
    .replace(/(\d{3})\s*\(\s*([+\-]?\d{1,3}|前計不|計不)\s*\)/g, "$1($2)")
    .replace(/(牡|牝|セン|セ|騸)\s+(\d{1,2})/g, "$1$2");
}

/* ---------- 列方向コピーの解析 ----------
   スマホで出馬表をコピーすると、行ではなく列単位で並ぶことがある
   （馬名が7つ続いた後に斤量が7つ続く、など）。この形は行ベースでは
   読めないため、「同じ条件を満たす値がN個連続するブロック＝1列」
   として取り出す。 */
function parseColumnar(t){
  const tok = glue(t).split(/\s+/).filter(Boolean);
  const isName = s => NAME_ONE.test(s) && !NOT_A_NAME.has(s);

  // 最長の「馬名が連続するブロック」を探す。その長さが頭数になる。
  let best = {start:-1, len:0};
  for(let i=0;i<tok.length;){
    if(!isName(tok[i])){ i++; continue; }
    let j = i;
    while(j < tok.length && isName(tok[j])) j++;
    if(j - i > best.len) best = {start:i, len:j - i};
    i = j;
  }
  if(best.len < 2) return null;

  const N = best.len;
  const names = tok.slice(best.start, best.start + N);
  const used = new Array(tok.length).fill(false);
  for(let k=best.start;k<best.start+N;k++) used[k] = true;

  // 未使用のトークンからN個連続するブロックを探して確保する
  function take(test, extra){
    for(let s=0; s + N <= tok.length; s++){
      let ok = true;
      for(let k=0;k<N;k++){
        if(used[s+k] || !test(tok[s+k])){ ok = false; break; }
      }
      if(!ok) continue;
      const vals = tok.slice(s, s + N);
      if(extra && !extra(vals)) continue;
      for(let k=0;k<N;k++) used[s+k] = true;
      return vals;
    }
    return null;
  }

  // 数値域の狭いものから確保して、取り違えを防ぐ
  const kinryo = take(s => /^(?:4[7-9]|5\d|6[0-3])(?:\.[05])?$/.test(s));
  const weight = take(s => /^\d{3}\((?:[+\-]?\d{1,3}|前計不|計不)\)$/.test(s));
  const sexAge = take(s => /^(?:牡|牝|セン|セ|騸)\d{1,2}$/.test(s));
  // 馬番は昇順に並ぶ列。人気（順不同）と区別するためここで確保する
  const umaban = take(s => /^\d{1,2}$/.test(s),
    v => Number(v[0]) >= 1 && v.every((x,k) => Number(x) === Number(v[0]) + k));
  const odds   = take(s => /^\d{1,4}\.\d$/.test(s), v => v.every(x => Number(x) >= 1));
  const ninki  = take(s => /^\d{1,2}$/.test(s), v => {
    const ns = v.map(Number).slice().sort((a,b) => a-b);
    return ns.every((x,k) => x === k + 1);
  });
  // 脚質の列（載っているサイトのみ）
  const style  = take(s => STYLE_RE_ONE.test(s));
  // 近走着順の列。左から順に前走・2走前・3走前とみなす。
  const chaku = [];
  for(let i=0;i<3;i++){
    const b = take(s => CHAKU_RE_ONE.test(s));
    if(!b) break;
    chaku.push(b);
  }

  const warnings = [];
  const horses = names.map((nm, k) => {
    const num = umaban ? Number(umaban[k]) : k + 1;
    const h = ENGINE ? ENGINE.defaultHorse(num) : {num: num};
    h.name = nm;
    h._got = [];
    if(kinryo){ h.kinryo = Number(kinryo[k]); h._got.push("斤量"); }
    if(odds){   h.odds   = Number(odds[k]);   h._got.push("オッズ"); }
    if(weight){
      const m = weight[k].match(/^(\d{3})\((.+)\)$/);
      h.weight = Number(m[1]);
      h.wdiff = /不/.test(m[2]) ? 0 : Number(m[2]);
      h._got.push("馬体重");
    }
    if(sexAge){
      const m = sexAge[k].match(/^(牡|牝|セン|セ|騸)(\d{1,2})$/);
      h.sex = m[1] === "騸" ? "セ" : (m[1] === "セン" ? "セ" : m[1]);
      h.age = Number(m[2]);
      h._got.push("性齢");
    }
    if(ninki){ h.pop = Number(ninki[k]); h._got.push("人気"); }
    if(style){ h.style = STYLE_TOKEN[style[k]] || h.style; h._got.push("脚質"); }
    if(chaku.length){
      chaku.forEach((col, i) => { h["last" + (i+1)] = chakuValue(col[k]); });
      h._got.push("近走着順");
    }
    return h;
  });

  warnings.push("列ごとに並んだ出馬表として読み取りました。");
  if(!umaban){
    warnings.push("馬番の列が見つからなかったため、馬名の並び順で1番から振りました。実際の馬番と違う場合は修正してください。");
  }

  // 列の対応がずれていないかの検算。
  // 位置で対応づける以上、列がずれても値としては成立してしまう。
  // 人気とオッズが両方取れていれば、両者の順位が一致するはずなので照合する。
  if(ninki && odds){
    const rank = horses.slice()
      .sort((a,b) => a.odds - b.odds)
      .map((h,i) => ({num:h.num, r:i+1}));
    const bad = rank.filter(x => {
      const h = horses.find(y => y.num === x.num);
      return h.pop !== x.r;
    });
    if(bad.length){
      warnings.push(`人気とオッズの順位が一致しません（${bad.length}頭）。列の対応がずれている可能性があるため、読み取り結果を確認してください。`);
    }
  }
  return {horses, warnings, columnar: true};
}

// 行方向・列方向の両方で試して、より多く読めた方を採用する
function parseHorses(text){
  const row = parseRowwise(text);
  const col = parseColumnar(normalize(text));
  if(col && col.horses.length > row.horses.length){
    return {horses: col.horses, warnings: col.warnings.concat(summarize(col.horses))};
  }
  return row;
}

// 取得状況の要約（どちらの解析でも共通）
function summarize(horses){
  const out = [];
  const n = horses.length;
  const gotCount = key => horses.filter(h => (h._got || []).indexOf(key) >= 0).length;
  const missing = [];
  ["オッズ", "斤量", "馬体重"].forEach(k => {
    const g = gotCount(k);
    if(g === 0) missing.push(`${k}（0/${n}頭）`);
    else if(g < n) missing.push(`${k}（${g}/${n}頭のみ）`);
  });
  if(missing.length) out.push("読み取れなかった項目があります: " + missing.join("、"));
  out.push("近走着順・騎手評価・調教評価・距離/馬場適性・脚質は出馬表から一意に決められないため、既定値のままです。予想前に調整してください。");
  return out;
}

function parseRowwise(text){
  const t = glue(normalize(text));
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

    // 脚質（載っているサイトのみ。厩舎名などに紛れないよう単独の語に限る）
    const st = seg.match(/(?:^|[\s\t])(逃げ|先行|差し|追込|追い込み|自在|マクリ|逃|先|差|追)(?=[\s\t]|$)/);
    if(st){ h.style = STYLE_TOKEN[st[1]] || h.style; h._got.push("脚質"); }

    // 近走着順（「1着」形式。左から順に前走・2走前・3走前とみなす）
    const ch = seg.match(/\d{1,2}着/g);
    if(ch && ch.length){
      ch.slice(0, 3).forEach((v, i) => { h["last" + (i+1)] = chakuValue(v); });
      h._got.push("近走着順");
    }

    horses.push(h);
  });

  horses.sort((a, b) => a.num - b.num);
  return {horses, warnings: warnings.concat(summarize(horses))};
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
