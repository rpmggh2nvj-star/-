/* ============================================================
   Turf Logic — ブラウザUI
   予想ロジックは持たず、すべて TurfEngine（keiba/engine.js）に委ねる。
   ビルド時に engine.js がこのファイルの前に埋め込まれる。
   ============================================================ */
"use strict";

const E = window.TurfEngine;
const $ = id => document.getElementById(id);

const STORAGE_KEY = "turf-logic-state-v2";

let horses = [];
let seq = 0;

function numOr(v, d){ const n = parseFloat(v); return isFinite(n) ? n : d; }
function escapeAttr(s){
  return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escapeHtml(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function yen(v){ return v.toLocaleString("ja-JP") + "円"; }

/* ---------- 競馬場セレクト ---------- */
function buildTrackSelect(){
  const sel = $("track");
  const group = (label, keys) => {
    const g = document.createElement("optgroup");
    g.label = label;
    keys.forEach(k => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = E.TRACKS[k].name;
      g.appendChild(o);
    });
    return g;
  };
  sel.appendChild(group("中央（JRA）", E.JRA_KEYS));
  sel.appendChild(group("南関東（NAR）", E.NAR_KEYS));
  sel.value = "tokyo";
}

// 南関はダートのみ。外回りがある競馬場だけ「回り」を出す。
function syncTrackUI(){
  const key = $("track").value;
  const t = E.TRACKS[key];
  if(!t) return;
  const isNar = t.org === "nar";

  const surf = $("surface");
  surf.querySelector('option[value="turf"]').disabled = isNar;
  if(isNar) surf.value = "dirt";
  surf.disabled = isNar;

  const hasOuter = !!(t.outer && t.outer[surf.value] != null);
  $("courseWrap").hidden = !hasOuter;
  if(!hasOuter) $("course").value = "inner";

  const st = E.straightOf({track:key, surface:surf.value, course:$("course").value});
  const shape = st >= 450 ? "直線が長く差しが届きやすい"
              : st >= 350 ? "標準的な直線"
              : st >= 290 ? "やや小回りで先行有利"
              : "小回りで逃げ・先行が有利";
  $("trackNote").textContent =
    `${t.name}（${isNar ? "南関" : "中央"}）・直線${st}m — ${shape}。`;
}

/* ---------- レース設定の読み書き ---------- */
function race(){
  return {
    track: $("track").value,
    surface: $("surface").value,
    course: $("course").value,
    distance: numOr($("distance").value, 1800),
    condition: numOr($("condition").value, 0),
    pace: $("pace").value,
    budget: numOr($("budget").value, 5000)
  };
}
function applyRace(r){
  if(!r) return;
  if(r.track && E.TRACKS[r.track]) $("track").value = r.track;
  if(r.surface) $("surface").value = r.surface;
  syncTrackUI();
  if(r.course) $("course").value = r.course;
  if(r.distance != null) $("distance").value = r.distance;
  if(r.condition != null) $("condition").value = r.condition;
  if(r.pace) $("pace").value = r.pace;
  if(r.budget != null) $("budget").value = r.budget;
  syncTrackUI();
}

/* ---------- 出走馬カード ---------- */
const GRADE5 = [{v:5,label:"S"},{v:4,label:"A"},{v:3,label:"B"},{v:2,label:"C"},{v:1,label:"D"}];
const GRADE4 = [{v:3,label:"◎"},{v:2,label:"○"},{v:1,label:"△"},{v:0,label:"×"}];

function opts(list, sel){
  return list.map(o =>
    `<option value="${o.v}"${String(o.v) === String(sel) ? " selected" : ""}>${o.label}</option>`).join("");
}

function renderHorses(){
  $("horseList").innerHTML = horses.map(h => `
    <div class="horse" data-id="${h.id}">
      <div class="horse-top">
        <div class="umaban">${h.num}</div>
        <input class="name" type="text" data-f="name" value="${escapeAttr(h.name)}" placeholder="馬名（任意）">
        <button type="button" class="danger rm" data-rm="1">削除</button>
      </div>
      <div class="horse-fields">
        <label class="field">馬番
          <input type="number" data-f="num" value="${h.num}" min="1" max="18" step="1">
        </label>
        <label class="field">単勝オッズ
          <input type="number" data-f="odds" value="${h.odds}" min="1" step="0.1">
        </label>
        <label class="field">脚質
          <select data-f="style">${opts(E.STYLES.map(s => ({v:s.v, label:s.label})), h.style)}</select>
        </label>
        <label class="field">前走着順
          <input type="number" data-f="last1" value="${h.last1}" min="0" max="18" step="1">
        </label>
        <label class="field">2走前
          <input type="number" data-f="last2" value="${h.last2}" min="0" max="18" step="1">
        </label>
        <label class="field">3走前
          <input type="number" data-f="last3" value="${h.last3}" min="0" max="18" step="1">
        </label>
        <label class="field">騎手
          <select data-f="jockey">${opts(GRADE5, h.jockey)}</select>
        </label>
        <label class="field">調教
          <select data-f="training">${opts(GRADE5, h.training)}</select>
        </label>
        <label class="field">距離適性
          <select data-f="dist">${opts(GRADE4, h.dist)}</select>
        </label>
        <label class="field">馬場適性
          <select data-f="baba">${opts(GRADE4, h.baba)}</select>
        </label>
        <label class="field">斤量 (kg)
          <input type="number" data-f="kinryo" value="${h.kinryo}" min="48" max="63" step="0.5">
        </label>
        <label class="field">馬体重増減
          <input type="number" data-f="wdiff" value="${h.wdiff}" step="2">
        </label>
      </div>
    </div>`).join("");

  $("emptyMsg").style.display = horses.length ? "none" : "block";
  $("countLabel").textContent = horses.length + "頭";
}

function horseById(el){
  const card = el.closest(".horse");
  return {card, h: horses.find(x => x.id === Number(card.dataset.id))};
}

$("horseList").addEventListener("input", e => {
  const f = e.target.dataset.f;
  if(!f) return;
  const {card, h} = horseById(e.target);
  if(!h) return;
  if(f === "name" || f === "style") h[f] = e.target.value;
  else {
    h[f] = numOr(e.target.value, 0);
    if(f === "num") card.querySelector(".umaban").textContent = h.num;
  }
});
$("horseList").addEventListener("change", e => {
  const f = e.target.dataset.f;
  if(f && e.target.tagName === "SELECT"){
    const {h} = horseById(e.target);
    if(h) h[f] = (f === "style") ? e.target.value : numOr(e.target.value, 0);
  }
});
$("horseList").addEventListener("click", e => {
  if(!e.target.dataset.rm) return;
  const {card} = horseById(e.target);
  horses = horses.filter(x => x.id !== Number(card.dataset.id));
  renderHorses();
});

function addHorses(n){
  let added = 0;
  for(let i=0;i<n;i++){
    if(horses.length >= E.MAX_FIELD) break;
    const used = new Set(horses.map(h => h.num));
    let next = 1;
    while(used.has(next) && next < E.MAX_FIELD) next++;
    horses.push(Object.assign(E.defaultHorse(next), {id: ++seq}));
    added++;
  }
  renderHorses();
  if(added < n) alert(`出走馬は最大 ${E.MAX_FIELD} 頭までです。`);
}

function setHorses(list){
  horses = list.map(h => Object.assign(E.defaultHorse(h.num || 1), h, {id: ++seq}));
  renderHorses();
  $("results").style.display = "none";
}

/* ============================================================
   予想の実行
   ============================================================ */
function run(){
  const r = race();
  const hs = horses.filter(h => h.num > 0);
  if(hs.length < 3){ alert("出走馬を3頭以上入力してください。"); return; }

  const seen = new Set();
  for(const h of hs){
    if(seen.has(h.num)){ alert("馬番 " + h.num + " が重複しています。"); return; }
    seen.add(h.num);
    if(h.odds < 1){ alert("オッズは1.0以上で入力してください（馬番 " + h.num + "）。"); return; }
  }

  const rows = E.analyze(r, hs);
  const {bets, value, dropped} = E.buildBets(rows, r.budget);
  const verdict = E.verdictOf(rows);

  const t = E.TRACKS[r.track];
  const sName = r.surface === "turf" ? "芝" : "ダート";
  const cName = ["良","稍重","重","不良"][r.condition] || "良";
  const pName = {high:"ハイ", mid:"平均", slow:"スロー"}[r.pace];
  const outer = (r.course === "outer" && t && t.outer && t.outer[r.surface] != null) ? "外回り・" : "";

  $("resultRace").textContent =
    `${t ? t.name : ""}${t ? (t.org === "nar" ? "（南関）" : "（中央）") : ""}・` +
    `${sName}${r.distance}m・${outer}${cName}・想定${pName}ペース・${hs.length}頭`;

  $("verdict").innerHTML =
    escapeHtml(verdict.title) +
    `<span class="sub">${escapeHtml(verdict.sub)}` +
    (value ? ` 妙味馬は <b>${value.h.num}番${value.h.name ? " " + escapeHtml(value.h.name) : ""}</b>` +
             `（市場評価比 ${value.edge.toFixed(2)} 倍・単勝期待値 ${value.ev.toFixed(2)}）。` : "") +
    `</span>`;

  // 情報量が乏しいときは、その旨をはっきり出す
  const info = rows.infoLevel;
  const note = $("infoNote");
  if(info < 0.35){
    note.hidden = false;
    note.innerHTML =
      `<b>情報量 ${Math.round(info*100)}%</b> — 判断材料が少ないため、ほぼオッズ通りの評価になっています。` +
      `近走着順・脚質・騎手評価を入力すると、独自の評価と妙味馬が出るようになります。`;
  }else{
    note.hidden = true;
  }

  const maxScore = Math.max.apply(null, rows.map(x => x.score));
  const minScore = Math.min.apply(null, rows.map(x => x.score));
  const span = Math.max(1, maxScore - minScore);

  $("rankList").innerHTML = rows.map((x, i) => {
    const mark = i < E.MARKS.length ? E.MARKS[i] : "";
    const markCls = i < 4 ? "m" + Math.min(i, 3) : "";
    const width = Math.max(4, Math.round((x.score - minScore) / span * 100));
    const tags = [`<span class="tag style">${E.STYLE_LABEL[x.h.style]}</span>`];
    if(x.edge >= 1.20) tags.push(`<span class="tag value">妙味</span>`);
    else if(x.edge <= 0.80) tags.push(`<span class="tag over">過剰人気</span>`);
    return `
      <div class="rank${i === 0 ? " top" : ""}">
        <div class="mark ${markCls}" title="${i < E.MARK_NAME.length ? E.MARK_NAME[i] : ""}">${mark || (i+1)}</div>
        <div class="num">${x.h.num}</div>
        <div class="body">
          <div class="nm">${escapeHtml(x.h.name || "（馬名未入力）")}</div>
          <div class="meta">
            <span class="mono">指数 ${x.score.toFixed(1)}</span>
            <span class="mono">単${x.h.odds.toFixed(1)}倍</span>
            ${tags.join("")}
          </div>
          <div class="bar"><span style="width:${width}%"></span></div>
        </div>
        <div class="stat">
          <div class="p">${(x.prob*100).toFixed(1)}%</div>
          <div class="ev">期待値 ${x.ev.toFixed(2)} ／ 市場比 ${x.edge.toFixed(2)}</div>
        </div>
      </div>`;
  }).join("");

  const spent = bets.reduce((s, x) => s + x.total, 0);
  $("budgetLabel").textContent = `予算 ${yen(r.budget)} ／ 使用 ${yen(spent)}`;
  $("betList").innerHTML = bets.map(x => `
    <div class="bet">
      <h3>${escapeHtml(x.name)}<span class="pts">${x.combos.length}点</span></h3>
      <div class="combo">${x.combos.map(escapeHtml).join("　")}</div>
      <div class="hint">${escapeHtml(x.memo)}</div>
      <div class="money">1点 <b>${yen(x.unit)}</b> ／ 計 <b>${yen(x.total)}</b></div>
    </div>`).join("");

  $("droppedNote").textContent = (dropped && dropped.length)
    ? `予算内に収めるため次の券種を除外しました: ${dropped.join("・")}` : "";

  $("results").style.display = "block";
  $("results").scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------- ペース自動判定 ---------- */
function autoPace(){
  const a = E.autoPace(horses);
  $("pace").value = a.pace;
  const label = {high:"ハイ", mid:"平均", slow:"スロー"}[a.pace];
  alert(`逃げ ${a.nige}頭・先行 ${a.senko}頭 → 想定ペースを「${label}」にしました。`);
}

/* ---------- 保存 / 呼出 ---------- */
function save(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({race: race(), horses}));
    alert("この端末に保存しました。");
  }catch(e){ alert("保存できませんでした：" + e.message); }
}
function load(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){ alert("保存されたデータがありません。"); return; }
  try{
    const data = JSON.parse(raw);
    applyRace(data.race);
    setHorses(data.horses || []);
  }catch(e){ alert("読込に失敗しました：" + e.message); }
}

/* ---------- 読み取り結果の表示 ---------- */
function showResult(ok, title, lines){
  const box = $("importResult");
  box.hidden = false;
  box.className = "import-result " + (ok ? "ok" : "ng");
  box.innerHTML = `<b>${escapeHtml(title)}</b>` +
    (lines.length ? "<ul>" + lines.map(l => `<li>${escapeHtml(l)}</li>`).join("") + "</ul>" : "");
}

/* ---------- 出馬表の貼り付け読み取り ---------- */
function importPaste(text){
  if(!text.trim()){
    showResult(false, "出馬表を貼り付けてください。", []);
    return;
  }
  const r = TurfParse.parseRacecard(text);
  if(!r.horses.length){
    showResult(false, "出走馬を読み取れませんでした。", r.warnings.concat([
      "馬番と馬名が同じ行に並ぶ形（例: 1 ハヤテノオージ 56.0 480(+2) 5.8）でコピーしてください。"
    ]));
    return;
  }

  if(r.race && Object.keys(r.race).length) applyRace(r.race);
  setHorses(r.horses.map(h => { const c = Object.assign({}, h); delete c._got; return c; }));

  const n = r.horses.length;
  const got = key => r.horses.filter(h => (h._got || []).indexOf(key) >= 0).length;
  const lines = [`オッズ ${got("オッズ")}/${n}頭 ・ 斤量 ${got("斤量")}/${n}頭 ・ 馬体重 ${got("馬体重")}/${n}頭`];

  const t = r.race && r.race.track && E.TRACKS[r.race.track];
  const missing = [];
  if(!t) missing.push("競馬場");
  if(!r.race || r.race.distance == null) missing.push("距離");
  if(!r.race || r.race.condition == null) missing.push("馬場状態");
  if(t) lines.push(`レース条件: ${t.name}${r.race.distance ? " " + r.race.distance + "m" : ""}` +
                   `${r.race.condition != null ? " 馬場" + (["良","稍重","重","不良"][r.race.condition]) : ""}`);
  if(missing.length) lines.push(`${missing.join("・")}は読み取れませんでした。上の欄で設定してください。`);

  // パーサーからの注意（馬番を推定した／列がずれている可能性など）は必ず出す。
  // 件数の要約と重複する2件だけ、ここでは省く。
  (r.warnings || []).forEach(w => {
    if(/読み取れなかった項目/.test(w) || /近走着順/.test(w)) return;
    lines.push(w);
  });
  lines.push("近走着順と脚質は出馬表から決められません。下の一覧に入力すると予想の精度が上がります。");

  showResult(true, `${n}頭を読み取りました。`, lines);
  $("pasteText").value = "";
  setTimeout(() => $("horseList").scrollIntoView({behavior:"smooth", block:"start"}), 200);
}

/* ---------- JSON読込（CLIの出力） ---------- */
function importJson(text){
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ showResult(false, "JSONとして読めませんでした。", [e.message]); return; }

  const list = Array.isArray(data) ? data : data.horses;
  if(!Array.isArray(list) || !list.length){
    showResult(false, "horses が見つかりません。", ["CLIが書き出したJSONを渡してください。"]);
    return;
  }
  if(data.race) applyRace(data.race);
  setHorses(list);
  $("importText").value = "";
  showResult(true, `${list.length}頭を読み込みました。`,
             Array.isArray(data.warnings) ? data.warnings : []);
}

/* ---------- サンプル ---------- */
const SAMPLE = {
  race:{track:"tokyo", surface:"turf", course:"inner", distance:2000, condition:0, pace:"mid", budget:5000},
  horses:[
    {num:1, name:"ハヤテノオージ", odds:5.8,  last1:2, last2:1, last3:4, jockey:4, training:4, dist:3, baba:2, kinryo:56,   wdiff:2,  style:"senko"},
    {num:2, name:"ミドリノカゼ",   odds:28.0, last1:7, last2:5, last3:8, jockey:2, training:3, dist:1, baba:2, kinryo:54,   wdiff:-6, style:"sashi"},
    {num:3, name:"クロガネマル",   odds:3.2,  last1:1, last2:3, last3:1, jockey:5, training:4, dist:3, baba:3, kinryo:57.5, wdiff:0,  style:"sashi"},
    {num:4, name:"シラユキヒメ",   odds:12.4, last1:4, last2:2, last3:6, jockey:3, training:5, dist:2, baba:2, kinryo:54,   wdiff:4,  style:"nige"},
    {num:5, name:"タカラブネ",     odds:45.0, last1:9, last2:8, last3:5, jockey:2, training:2, dist:1, baba:1, kinryo:55,   wdiff:0,  style:"oikomi"},
    {num:6, name:"アカツキノホシ", odds:8.1,  last1:3, last2:6, last3:2, jockey:4, training:3, dist:2, baba:3, kinryo:56,   wdiff:-2, style:"senko"},
    {num:7, name:"ユウヅキノマイ", odds:19.6, last1:5, last2:11,last3:3, jockey:3, training:4, dist:2, baba:1, kinryo:54,   wdiff:8,  style:"nige"},
    {num:8, name:"リュウセイオー", odds:6.7,  last1:2, last2:4, last3:2, jockey:5, training:3, dist:3, baba:2, kinryo:57,   wdiff:0,  style:"oikomi"}
  ]
};
function loadSample(){
  applyRace(SAMPLE.race);
  setHorses(SAMPLE.horses);
}

/* ---------- イベント ---------- */
$("track").addEventListener("change", syncTrackUI);
$("surface").addEventListener("change", syncTrackUI);
$("course").addEventListener("change", syncTrackUI);

$("btnAdd").addEventListener("click", () => addHorses(1));
$("btnAdd5").addEventListener("click", () => addHorses(5));
$("btnRun").addEventListener("click", run);
$("btnSample").addEventListener("click", loadSample);
$("btnSave").addEventListener("click", save);
$("btnLoad").addEventListener("click", load);
$("btnAutoPace").addEventListener("click", autoPace);
$("btnClear").addEventListener("click", () => {
  if(!confirm("入力内容をすべて消去します。よろしいですか？")) return;
  horses = [];
  renderHorses();
  $("results").style.display = "none";
});

$("btnImport").addEventListener("click", () => {
  const box = $("importBox");
  box.hidden = !box.hidden;
  if(!box.hidden) $("pasteText").focus();
});
const closeImport = () => { $("importBox").hidden = true; };
$("btnImportClose").addEventListener("click", closeImport);
$("btnImportClose2").addEventListener("click", closeImport);

// タブ切替
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const on = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b === btn));
    $("tabPaste").hidden = on !== "paste";
    $("tabJson").hidden  = on !== "json";
    $("importResult").hidden = true;
  });
});

$("btnPasteRun").addEventListener("click", () => importPaste($("pasteText").value));
$("btnImportRun").addEventListener("click", () => {
  const txt = $("importText").value.trim();
  if(!txt){ showResult(false, "JSONを貼り付けるか、ファイルを選んでください。", []); return; }
  importJson(txt);
});
$("importFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const rd = new FileReader();
  rd.onload = () => importJson(String(rd.result));
  rd.onerror = () => showResult(false, "ファイルを読めませんでした。", []);
  rd.readAsText(f, "utf-8");
  e.target.value = "";
});

/* ---------- 初期表示 ---------- */
buildTrackSelect();
syncTrackUI();
addHorses(6);
