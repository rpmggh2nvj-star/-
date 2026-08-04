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

// 人名（騎手）らしいトークン。見出し語や競馬場名は騎手ではない。
const NOT_A_PERSON = new Set([
  "馬名","騎手","厩舎","概舎","調教師","性齢","斤量","人気","馬体重","増減","馬番","枠番","枠",
  "前走","二走前","三走前","単勝","複勝","オッズ","脚質","予想","印","切替","調教","評価",
  "中央","地方","距離","馬場","発走","本日","結果","成績","出走","除外","取消","中止",
  "美浦","栗東","南関","公営"
]);
const PERSON_RE = /^[一-龥ぁ-んァ-ヴー]{2,6}$/;
function isPerson(s, trackNames){
  if(!PERSON_RE.test(s) || NOT_A_PERSON.has(s)) return false;
  if(trackNames && trackNames.has(s)) return false;   // 厩舎欄の所属地は騎手ではない
  return true;
}

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
  // afterLabel を渡すと、その見出し語より後ろのブロックを優先する。
  // 騎手と厩舎のように見た目が同じ列が並ぶ場合の取り違えを防ぐ。
  function take(test, extra, afterLabel){
    const scan = from => {
      for(let s=from; s + N <= tok.length; s++){
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
    };
    if(afterLabel){
      const at = tok.indexOf(afterLabel);
      if(at >= 0){
        const hit = scan(at + 1);
        if(hit) return hit;
      }
    }
    return scan(0);
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
  // 騎手の列。厩舎欄と見分けるため見出し「騎手」の後ろを優先する。
  const trackNames = new Set(ENGINE ? ENGINE.TRACK_KEYS.map(k => ENGINE.TRACKS[k].name) : []);
  const jockey = take(s => isPerson(s, trackNames), null, "騎手");
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
    if(jockey){ h.jockeyName = jockey[k]; h._got.push("騎手名"); }
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

/* ============================================================
   netkeiba の馬柱形式（PDF）の解析
   ------------------------------------------------------------
   1頭が6行のブロックで構成される。表形式ではないため、
   行・列いずれの解析でも読めない（父名・母名・前走相手の馬名が
   混ざり、馬名を取り違える）。ブロック構造そのものを読む。

     A 父名        性齢・毛色   過去4走の日付
     B 馬名        クラスと着順（4走ぶん）
     C 母名(母父)  騎手
     D 枠 馬番 印  厩舎 …（過去4走の頭数・人気・騎手・馬体重）
     E 調教師 馬主 斤量 …（過去4走の距離・馬場・タイム）
     F 脚質 オッズ(人気) …（過去4走の相手）
   ============================================================ */
const KIN_CELL = /^[▲△☆◇★]?(\d{2}(?:\.\d)?)$/;

function parseNetkeiba(text){
  const lines = normalize(text).split("\n");
  const cells = lines.map(l => l.split("\t").map(s => s.trim()));

  // D行（枠・馬番で始まり、厩舎が「場・調教師」の形で入る行）を探す
  const anchors = [];
  cells.forEach((c, i) => {
    if(c.length < 4) return;
    if(!/^\d{1,2}$/.test(c[0]) || !/^\d{1,2}$/.test(c[1])) return;
    if(!c.slice(2, 6).some(x => /^[^\s]+・[^\s]+$/.test(x))) return;
    if(i < 3 || i + 2 >= cells.length) return;
    anchors.push(i);
  });
  if(anchors.length < 2) return null;

  const horses = [];
  const warnings = [];
  anchors.forEach(i => {
    const A = cells[i-3], B = cells[i-2], C = cells[i-1];
    const D = cells[i],   E = cells[i+1], F = cells[i+2];

    const num = Number(D[1]);
    if(!(num >= 1 && num <= 18)) return;
    const h = ENGINE ? ENGINE.defaultHorse(num) : {num: num};
    h._got = [];

    // 馬名（B行の先頭）。父名はA行、母名はC行にある。
    if(B[0] && NAME_ONE.test(B[0])){ h.name = B[0]; h._got.push("馬名"); }

    // 性齢（A行の2列目「牝5 栗」）
    const sa = (A[1] || "").match(/(牡|牝|セン|セ|騸)(\d{1,2})/);
    if(sa){ h.sex = sa[1] === "騸" ? "セ" : sa[1]; h.age = Number(sa[2]); h._got.push("性齢"); }

    // 騎手（C行の末尾。「替」が入る場合はその後ろ）
    const jk = C.slice(1).filter(x => x && x !== "替" && PERSON_RE.test(x));
    if(jk.length){ h.jockeyName = jk[jk.length - 1]; h._got.push("騎手名"); }

    // 斤量（E行で最初に現れる 47〜63 の値。▲△などの減量記号は外す）
    const kin = E.find(x => KIN_CELL.test(x) && (() => {
      const v = Number(x.match(KIN_CELL)[1]); return v >= 47 && v <= 63;
    })());
    if(kin){ h.kinryo = Number(kin.match(KIN_CELL)[1]); h._got.push("斤量"); }

    // 脚質（F行の先頭）とオッズ・人気（F行の2列目「50.0 (5人気)」）
    if(F[0] && STYLE_TOKEN[F[0]]){ h.style = STYLE_TOKEN[F[0]]; h._got.push("脚質"); }
    const od = (F[1] || "").match(/(\d{1,4}\.\d)\s*\((\d{1,2})人気\)/);
    if(od){
      h.odds = Number(od[1]);
      h.pop = Number(od[2]);
      h._got.push("オッズ");
      h._got.push("人気");
    }

    // 近走着順（B行の、馬名以降にある「数字だけのセル」）
    const chaku = B.slice(1).filter(x => /^\d{1,2}$/.test(x)).map(Number);
    if(chaku.length){
      h.last1 = chaku[0] || 0;
      h.last2 = chaku[1] || 0;
      h.last3 = chaku[2] || 0;
      h._got.push("近走着順");
    }

    // 過去走の距離と馬場（E行）。適性の推定に使う。
    const eLine = E.join("\t");
    const dists = [];
    const re = /(?:ダ|芝)(\d{3,4})/g;
    let m;
    while((m = re.exec(eLine)) !== null) dists.push(Number(m[1]));
    const babas = (eLine.match(/[左右直]\s*(良|稍|重|不)/g) || [])
      .map(x => x.replace(/[左右直]\s*/, ""));
    h._past = chaku.map((pos, k) => ({pos: pos, dist: dists[k], baba: babas[k]}))
                   .filter(p => p.pos > 0);

    horses.push(h);
  });

  if(horses.length < 2) return null;
  horses.sort((a, b) => a.num - b.num);
  warnings.push("netkeibaの馬柱形式として読み取りました。");
  return {horses, warnings, netkeiba: true};
}

/* ---------- 過去走から適性を推定する ----------
   道悪・今回と近い距離での着順を、その馬の平均着順と比べる。
   絶対的な着順ではなく「自分の平均より良いか」で見るため、
   クラスの差に左右されにくい。 */
function inferAptitude(horses, raceDistance){
  const grade = diff =>
    diff >= 1.5 ? 3 : diff >= 0 ? 2 : diff >= -1.5 ? 1 : 0;

  horses.forEach(h => {
    const past = h._past || [];
    if(past.length < 2) return;
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const all = avg(past.map(p => p.pos));

    // 馬場適性：稍重・重・不良での成績
    const off = past.filter(p => /稍|重|不/.test(p.baba || "")).map(p => p.pos);
    if(off.length){
      h.baba = grade(all - avg(off));      // 平均より良ければ加点
      h._got.push("馬場適性");
    }

    // 距離適性：今回と±200m以内での成績
    if(raceDistance){
      const near = past.filter(p => p.dist && Math.abs(p.dist - raceDistance) <= 200)
                       .map(p => p.pos);
      if(near.length){
        h.dist = grade(all - avg(near));
        h._got.push("距離適性");
      }
    }
  });
}

// 行方向・列方向の両方で試して、より多く読めた方を採用する
function parseHorses(text, raceDistance){
  // netkeibaの馬柱形式は構造がまったく違うので最優先で試す
  const nk = parseNetkeiba(text);
  if(nk && nk.horses.length >= 2){
    inferAptitude(nk.horses, raceDistance);
    return {horses: nk.horses, netkeiba: true,
            warnings: nk.warnings.concat(summarize(nk.horses))};
  }
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
    found.push({num, name: c.name, start: c.start, end: c.end});
  });

  // 各馬の区間は「次に採用した馬の直前」まで。候補で区切ると、
  // カタカナの騎手名（デムーロ等）で区間が途中で切れてしまう。
  found.forEach((f, i) => {
    const segEnd = (i + 1 < found.length) ? found[i + 1].start : t.length;
    f.seg = t.slice(f.end, segEnd);
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

    // 騎手名（斤量・オッズを取り除いた後に最初に現れる人名らしい語）
    const trackNames2 = new Set(ENGINE ? ENGINE.TRACK_KEYS.map(k => ENGINE.TRACKS[k].name) : []);
    const jk = seg.match(/(?:^|[\s\t])([一-龥ぁ-んァ-ヴー]{2,6})(?=[\s\t]|$)/g);
    if(jk){
      const cand = jk.map(x => x.trim()).find(x => isPerson(x, trackNames2));
      if(cand){ h.jockeyName = cand; h._got.push("騎手名"); }
    }

    // 脚質（載っているサイトのみ。厩舎名などに紛れないよう単独の語に限る）
    const st = seg.match(/(?:^|[\s\t])(逃げ|先行|差し|追込|追い込み|自在|マクリ|逃|先|差|追)(?=[\s\t]|$)/);
    if(st){ h.style = STYLE_TOKEN[st[1]] || h.style; h._got.push("脚質"); }

    // 近走着順（左から順に前走・2走前・3走前とみなす）
    // 中止・取消も1走として数える。飛ばすと着順が1つずつ前にずれてしまう。
    const ch = seg.match(/\d{1,2}着|中止|取消|除外|失格/g);
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
  const h = parseHorses(text, r.race.distance);
  // 馬柱には過去走のレース名・R番号が並ぶ。今回のものと取り違えるので使わない。
  if(h.netkeiba){ delete r.race.name; delete r.race.raceNo; }
  return {
    race: r.race,
    horses: h.horses,
    warnings: r.warnings.concat(h.warnings),
    text
  };
}

return {parseRacecard, parseHorses, detectRace, htmlToText, looksLikeHtml, normalize};
});
