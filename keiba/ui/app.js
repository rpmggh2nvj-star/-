/* ============================================================
   Turf Logic — ブラウザUI
   予想ロジックは持たず、すべて TurfEngine（keiba/engine.js）に委ねる。
   ビルド時に engine.js がこのファイルの前に埋め込まれる。
   ============================================================ */
"use strict";

const E = window.TurfEngine;
const LN = window.TurfLearn;
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
  sel.appendChild(group("南関東", E.NANKAN_KEYS));
  sel.appendChild(group("その他の地方", E.CHIHO_KEYS));
  sel.value = "tokyo";
}

// 南関はダートのみ。外回りがある競馬場だけ「回り」を出す。
function syncTrackUI(){
  const key = $("track").value;
  const t = E.TRACKS[key];
  if(!t) return;
  const isNar = t.org === "nar";

  // 芝コースを持たない競馬場ではダートに固定する（地方の多くはダートのみ）
  const noTurf = t.straight.turf == null && !(t.outer && t.outer.turf != null);
  const surf = $("surface");
  surf.querySelector('option[value="turf"]').disabled = noTurf;
  if(noTurf) surf.value = "dirt";
  surf.disabled = noTurf;

  const hasOuter = !!(t.outer && t.outer[surf.value] != null);
  $("courseWrap").hidden = !hasOuter;
  if(!hasOuter) $("course").value = "inner";

  const st = E.straightOf({track:key, surface:surf.value, course:$("course").value});
  const shape = st >= 450 ? "直線が長く差しが届きやすい"
              : st >= 350 ? "標準的な直線"
              : st >= 290 ? "やや小回りで先行有利"
              : "小回りで逃げ・先行が有利";
  const area = t.area === "jra" ? "中央" : t.area === "nankan" ? "南関" : "地方";
  $("trackNote").textContent = `${t.name}（${area}）・直線${st}m — ${shape}。`;
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
    budget: numOr($("budget").value, 5000),
    policy: $("policy").value,
    sanrenpuku: $("useSanrenpuku").checked,
    sanrentan: $("useSanrentan").checked
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
  if(r.policy && E.POLICIES[r.policy]) $("policy").value = r.policy;
  $("useSanrenpuku").checked = !!r.sanrenpuku;
  $("useSanrentan").checked  = !!r.sanrentan;
  syncPolicyNote();
  syncTrackUI();
}

/* 選んだ買い方が何をするのかを、選んだ場で見せる */
function syncPolicyNote(){
  const p = E.policyOf($("policy").value);
  $("policyNote").textContent = p.lead;
}

/* ============================================================
   騎手評価
   一度つけた評価を騎手名で覚えておき、次のレースで自動的に当てる。
   南関のように同じ騎手が繰り返し乗る場合、数レースでほぼ入力不要になる。
   ============================================================ */
const JOCKEY_KEY = "turf-logic-jockeys-v1";

function loadJockeys(){
  try{ return JSON.parse(localStorage.getItem(JOCKEY_KEY) || "{}") || {}; }
  catch(e){ return {}; }
}
function saveJockeys(map){
  try{ localStorage.setItem(JOCKEY_KEY, JSON.stringify(map)); }catch(e){}
}
let jockeyRatings = loadJockeys();

/* 騎手名の辞書。
   紙面では「小野楓馬」が「小野楓」で切れることがある。切れた名前のままだと
   同じ騎手が別人として記憶され、評価が引き継がれない。
   出馬表を読むたびに、そこで見つかった長い表記をこの端末へ貯めておき、
   次からは切れた名前を伸ばせるようにする。 */
const JOCKEY_NAMES_KEY = "turf-logic-jockey-names-v1";
const MAX_JOCKEY_NAMES = 600;

function loadJockeyNames(){
  try{
    const a = JSON.parse(localStorage.getItem(JOCKEY_NAMES_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  }catch(e){ return []; }
}
let knownJockeyNames = loadJockeyNames();

function rememberJockeyNames(list){
  if(!list || !list.length) return;
  const seen = new Set(knownJockeyNames);
  list.forEach(n => { if(n && !seen.has(n)){ seen.add(n); knownJockeyNames.push(n); } });
  if(knownJockeyNames.length > MAX_JOCKEY_NAMES){
    knownJockeyNames = knownJockeyNames.slice(-MAX_JOCKEY_NAMES);
  }
  try{ localStorage.setItem(JOCKEY_NAMES_KEY, JSON.stringify(knownJockeyNames)); }catch(e){}
}

// 端末に貯めた表記＋評価済みの騎手名で、切れた名前を伸ばす
function expandWithMemory(list){
  const all = knownJockeyNames.concat(Object.keys(jockeyRatings));
  /* 貯めた中に切れた表記（「落合玄」）が混ざっていることがある。
     そのままだと「載っている名前」とみなして伸ばせなくなるので、
     より長い表記が別にあるものは辞書から外す。 */
  const pool = new Set(all.filter(n =>
    !all.some(m => m.length > n.length && m.indexOf(n) === 0)));
  return TurfParse.expandJockeyNames(list, pool).grown;
}

// 記憶している評価を出走馬へ当てる
function applyJockeyRatings(){
  horses.forEach(h => {
    if(h.jockeyName && jockeyRatings[h.jockeyName] != null){
      h.jockey = jockeyRatings[h.jockeyName];
    }
  });
}

function uniqueJockeys(){
  const seen = [];
  horses.forEach(h => {
    if(h.jockeyName && seen.indexOf(h.jockeyName) < 0) seen.push(h.jockeyName);
  });
  return seen;
}

function renderJockeys(){
  const names = uniqueJockeys();
  const panel = $("jockeyPanel");
  panel.hidden = names.length === 0;
  if(!names.length) return;

  const known = names.filter(n => jockeyRatings[n] != null).length;
  $("jockeyCount").textContent = `${names.length}人（記憶済み ${known}人）`;

  // 記録した結果から集計した成績を添える
  const stats = {};
  (typeof H !== "undefined" && H ? H.jockeyStats(history) : []).forEach(x => { stats[x.name] = x; });

  $("jockeyList").innerHTML = names.map(n => {
    const nums = horses.filter(h => h.jockeyName === n).map(h => h.num).join("・");
    const cur = horses.find(h => h.jockeyName === n).jockey;
    const remembered = jockeyRatings[n] != null;
    const st = stats[n];
    let line = "";
    if(st){
      const g = st.suggested;
      const label = g ? GRADE5.find(x => x.v === g).label : null;
      line = `<div class="jk-stat mono">${st.rides}戦 勝率${st.winPct}% 複勝${st.showPct}%` +
             (label ? ` <button type="button" class="jk-sug" data-suggest="${escapeAttr(n)}" data-grade="${g}">${label}を適用</button>` : "") +
             `</div>`;
    }
    return `
      <div class="jockey">
        <div class="jk-name">${escapeHtml(n)}${remembered ? '<span class="jk-mark">記憶</span>' : ""}</div>
        <div class="jk-horses">${nums}番</div>
        <select data-jockey="${escapeAttr(n)}">${opts(GRADE5, cur)}</select>
        ${line}
      </div>`;
  }).join("");
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
    <div class="horse${h.scratched ? " scratched" : ""}" data-id="${h.id}">
      <div class="horse-top">
        <div class="umaban">${h.num}</div>
        <input class="name" type="text" data-f="name" value="${escapeAttr(h.name)}" placeholder="馬名（任意）">
        <label class="scr" title="出走取消・除外の馬は予想の対象から外します">
          <input type="checkbox" data-f="scratched"${h.scratched ? " checked" : ""}>取消
        </label>
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
        <label class="field">騎手名
          <input type="text" data-f="jockeyName" value="${escapeAttr(h.jockeyName || "")}" placeholder="（任意）">
        </label>
        <label class="field">騎手評価
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
        <label class="field">馬体重 (kg)
          <input type="number" data-f="weight" value="${h.weight || ""}" min="300" max="700" step="2"
                 placeholder="${h.prevWeight ? "前走 " + h.prevWeight : "未発表"}">
        </label>
        <label class="field">増減 (kg)${h.prevWeight ? `<span class="prevw">前走 ${h.prevWeight}kg</span>` : ""}
          <input type="number" data-f="wdiff" value="${h.wdiff}" step="2">
        </label>
      </div>
    </div>`).join("");

  $("emptyMsg").style.display = horses.length ? "none" : "block";
  const scr = horses.filter(h => h.scratched).length;
  $("countLabel").textContent = (horses.length - scr) + "頭" + (scr ? `（取消 ${scr}頭）` : "");
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
  if(f === "name" || f === "style" || f === "jockeyName") h[f] = e.target.value;
  else {
    h[f] = numOr(e.target.value, 0);
    if(f === "num") card.querySelector(".umaban").textContent = h.num;
    /* 今回の馬体重を入れたら、前走の値との差を増減へ自動で入れる。
       前走が分からない馬（＝差が計算できない馬）は増減を触らない。 */
    if(f === "weight" && h.prevWeight && h.weight >= 300 && h.weight <= 700){
      h.wdiff = h.weight - h.prevWeight;
      const w = card.querySelector('[data-f="wdiff"]');
      if(w) w.value = h.wdiff;
    }
  }
  if(f === "jockeyName") renderJockeys();
});
$("horseList").addEventListener("change", e => {
  const f = e.target.dataset.f;
  if(f === "scratched"){
    const {card, h} = horseById(e.target);
    if(!h) return;
    h.scratched = e.target.checked;
    card.classList.toggle("scratched", h.scratched);
    const scr = horses.filter(x => x.scratched).length;
    $("countLabel").textContent = (horses.length - scr) + "頭" + (scr ? `（取消 ${scr}頭）` : "");
    return;
  }
  if(f && e.target.tagName === "SELECT"){
    const {h} = horseById(e.target);
    if(!h) return;
    h[f] = (f === "style") ? e.target.value : numOr(e.target.value, 0);
    if(f === "jockey" && h.jockeyName){
      jockeyRatings[h.jockeyName] = h.jockey;
      saveJockeys(jockeyRatings);
      renderJockeys();
    }
  }
});
$("horseList").addEventListener("click", e => {
  if(!e.target.dataset.rm) return;
  const {card} = horseById(e.target);
  horses = horses.filter(x => x.id !== Number(card.dataset.id));
  renderHorses();
  renderJockeys();
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
  renderJockeys();
  if(added < n) alert(`出走馬は最大 ${E.MAX_FIELD} 頭までです。`);
}

function setHorses(list){
  horses = list.map(h => Object.assign(E.defaultHorse(h.num || 1), h, {id: ++seq}));
  applyJockeyRatings();
  renderHorses();
  renderJockeys();
  $("results").style.display = "none";
}

/* ============================================================
   予想の実行
   ============================================================ */
function run(){
  const r = race();
  const all = horses.filter(h => h.num > 0);
  const scratched = all.filter(h => h.scratched);
  const hs = all.filter(h => !h.scratched);          // 取消馬は走らないので外す
  if(hs.length < 3){ alert("出走する馬を3頭以上入力してください（取消の馬は数えません）。"); return; }

  const seen = new Set();
  for(const h of all){
    if(seen.has(h.num)){ alert("馬番 " + h.num + " が重複しています。"); return; }
    seen.add(h.num);
    if(!h.scratched && h.odds < 1){ alert("オッズは1.0以上で入力してください（馬番 " + h.num + "）。"); return; }
  }

  const tn = activeTune();
  const rows = E.analyze(r, hs, tn);
  // 締切間際にオッズを見るだけで判断できるよう、馬ごとの買い下限を出しておく
  E.fillBreakEven(r, hs, rows, tn);
  const {bets, value, dropped, grade, upset, spend, policy, hitChance} =
    E.buildBets(rows, r.budget, {
      policy: r.policy,
      extras: {sanrenpuku: r.sanrenpuku, sanrentan: r.sanrentan}
    });
  const verdict = E.verdictOf(rows);

  const t = E.TRACKS[r.track];
  const sName = r.surface === "turf" ? "芝" : "ダート";
  const cName = ["良","稍重","重","不良"][r.condition] || "良";
  const pName = {high:"ハイ", mid:"平均", slow:"スロー"}[r.pace];
  const outer = (r.course === "outer" && t && t.outer && t.outer[r.surface] != null) ? "外回り・" : "";

  $("resultRace").textContent =
    `${t ? t.name : ""}${t ? "（" + (t.area === "jra" ? "中央" : t.area === "nankan" ? "南関" : "地方") + "）" : ""}・` +
    `${sName}${r.distance}m・${outer}${cName}・想定${pName}ペース・${hs.length}頭` +
    (scratched.length ? `（取消 ${scratched.map(h => h.num + "番").join("・")}）` : "");

  // このレースを買うべきかどうかを最初に、いちばん大きく出す
  const gradeBox = $("gradeBox");
  gradeBox.className = "grade g-" + grade.grade;
  gradeBox.innerHTML =
    `<div class="g-title">${escapeHtml(grade.title)}</div>` +
    `<div class="g-reason">${escapeHtml(grade.reason)}</div>` +
    `<div class="g-advice">${escapeHtml(grade.advice)}</div>`;

  // 荒れ度と、その場合の買い方
  const ub = $("upsetBox");
  ub.className = "upset u-" + upset.level;
  ub.innerHTML =
    `<div class="u-head"><span class="u-label">荒れ度 ${escapeHtml(upset.label)}</span>` +
    `<span class="u-score mono">${upset.score}</span><span class="u-max">/100</span></div>` +
    `<div class="u-bar"><span style="width:${upset.score}%"></span></div>` +
    `<ul class="u-reasons">${upset.reasons.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` +
    `<div class="u-advice"><b>この荒れ度での買い方</b>` +
    `<ul>${upset.advice.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`;

  $("verdict").innerHTML =
    escapeHtml(verdict.title) +
    `<span class="sub">${escapeHtml(verdict.sub)}` +
    (value ? ` 妙味馬は <b>${value.h.num}番${value.h.name ? " " + escapeHtml(value.h.name) : ""}</b>` +
             `（単勝期待値 ${value.ev.toFixed(2)}・市場評価比 ${value.edge.toFixed(2)} 倍）。` : "") +
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
    if(E.isValue(x)) tags.push(`<span class="tag value">妙味</span>`);
    else if(E.isOverbet(x)) tags.push(`<span class="tag over">過剰人気</span>`);
    /* 買い下限＝この馬の単勝を買ってよいオッズの下限。
       締切直前は、この数字とオッズ表示を見比べるだけで判断できる。 */
    tags.push(x.minOdds == null
      ? `<span class="tag none">買えない</span>`
      : `<span class="tag floor${x.h.odds >= x.minOdds ? " on" : ""}">${x.minOdds}倍〜で買い</span>`);
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
  $("budgetLabel").textContent = bets.length
    ? `予算 ${yen(r.budget)} ／ 投入 ${yen(spend)} ／ 使用 ${yen(spent)}`
    : `予算 ${yen(r.budget)} ／ 使用 0円`;

  /* この買い目で「何か1点でも当たる」確率。券種をまたぐ的中の重なりを
     数え上げて出している。当たる回数がどれくらい見込めるかを先に示す。 */
  const hc = $("hitChance");
  hc.hidden = !bets.length;
  if(bets.length){
    hc.innerHTML =
      `<span class="hc-k">この買い目で何か当たる確率</span>` +
      `<span class="hc-v mono">${(hitChance*100).toFixed(0)}%</span>` +
      `<span class="hc-p">買い方：${escapeHtml(policy.label)}</span>` +
      `<span class="hc-note">推定勝率から出した見込みです。実際はこれより数ポイント下がります。</span>`;
  }

  $("betList").innerHTML = bets.length ? bets.map(x => `
    <div class="bet">
      <h3>${escapeHtml(x.name)}<span class="pts">${x.combos.length}点</span></h3>
      <div class="combo">${x.combos.map(escapeHtml).join("　")}</div>
      <div class="odds-need">
        <span class="k">的中</span><span class="v">${(x.hit*100).toFixed(1)}%</span>
        ${x.evKnown != null
          ? `<span class="k">期待値</span><span class="v ev-ok">${x.evKnown.toFixed(2)}</span>`
          : x.evEst != null
            ? `<span class="k">推定期待値</span><span class="v ${x.evEst >= 1 ? "ev-ok" : "ev-ng"}">${x.evEst.toFixed(2)}</span>`
            : `<span class="k">必要オッズ</span><span class="v">${x.needOdds.toFixed(1)}倍〜</span>`}
      </div>
      ${x.underEv ? `<div class="under-ev">推定期待値が 1.0 を割っています。当たる回数を支えるために買う1点で、
        この点だけを見れば長い目では元本を割ります。回収率を優先するなら「回収率重視」を選んでください。</div>` : ""}
      ${(x.points && x.points.length > 1) ? `
      <table class="pt-table">
        <tr><th>買い目</th><th>金額</th><th>的中</th><th>必要オッズ</th><th>推定期待値</th></tr>
        ${x.points.map(pt => `<tr>
          <td class="mono">${escapeHtml(pt.combo)}</td>
          <td class="mono yen">${yen(pt.yen != null ? pt.yen : x.unit)}</td>
          <td class="mono">${(pt.hit*100).toFixed(1)}%</td>
          <td class="mono need">${pt.needOdds.toFixed(1)}倍〜</td>
          <td class="mono need">${pt.ev != null ? pt.ev.toFixed(2) : "—"}</td>
        </tr>`).join("")}
      </table>
      <div class="hint">金額は点ごとに変えてあります（資金がいちばん速く増える割合に比例）。
        実際のオッズが必要オッズを下回る点は、その点だけ外してください。</div>` : ""}
      <div class="hint">${escapeHtml(x.memo)}</div>
      <div class="money">${x.combos.length > 1 ? "" : "1点 "}<b>${yen(x.total)}</b>${x.combos.length > 1 ? " ／ " + x.combos.length + "点" : ""}</div>
    </div>`).join("")
    : `<p class="empty">このレースは買いません。資金を次のレースに残してください。</p>`;

  const notes = [];
  if(dropped && dropped.length) notes.push(`予算内に収めるため次の券種を除外しました: ${dropped.join("・")}`);
  if(bets.some(x => x.evKnown == null)){
    notes.push("連系の推定期待値は、単勝オッズから市場の組み合わせ確率を組み立てて出しています。" +
               "実際のオッズが確認できるなら、必要オッズを下回る点はその点だけ外してください。");
  }
  const cutN = bets.reduce((s, x) => s + (x.cut || 0), 0);
  if(cutN) notes.push(`割の合わない ${cutN}点 は、はじめから外してあります。`);
  if(bets.length && !r.sanrenpuku && !r.sanrentan){
    notes.push("三連複・三連単は出していません。控除率が高いうえ推定の誤差も大きく、" +
               "検証では的中率でも回収率でも複勝・ワイドに負けたためです。買う場合は上のチェックを入れてください。");
  }
  $("droppedNote").textContent = notes.join(" ");

  lastRun = {race: r, rows: rows, bets: bets, grade: grade, upset: upset};
  $("saveNote").textContent = "";

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
function importPaste(text, sourceLabel){
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

  /* 騎手名の補完。まず今回の紙面に載っていた表記を覚え、
     そのうえで端末に貯まった表記で、切れたままの名前を伸ばす。 */
  rememberJockeyNames(r.jockeys);
  const grewByMemory = expandWithMemory(r.horses);
  rememberJockeyNames(r.horses.map(h => h.jockeyName).filter(Boolean));

  setHorses(r.horses.map(h => { const c = Object.assign({}, h); delete c._got; return c; }));

  // 取消馬にはオッズも馬体重も出ないので、読み取り率の分母から外す
  const live = r.horses.filter(h => !h.scratched);
  const n = live.length;
  const got = key => live.filter(h => (h._got || []).indexOf(key) >= 0).length;
  const lines = [`オッズ ${got("オッズ")}/${n}頭 ・ 斤量 ${got("斤量")}/${n}頭 ・ 馬体重 ${got("馬体重")}/${n}頭`];
  if(got("近走着順") || got("脚質")){
    lines.push(`近走着順 ${got("近走着順")}/${n}頭 ・ 脚質 ${got("脚質")}/${n}頭`);
  }
  if(got("騎手名")) lines.push(`騎手名 ${got("騎手名")}/${n}頭` +
    (grewByMemory ? `（うち ${grewByMemory}頭 は記憶している表記に直しました）` : ""));

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
  if(!got("近走着順") || !got("脚質")){
    lines.push("近走着順・脚質が取れていません。出馬表の「成績」や「馬柱」の表示に切り替えてコピーすると読み取れる場合があります。" +
               "取れない場合は下の一覧に手で入れてください（この2つが予想の精度を大きく左右します）。");
  }

  const scrN = r.horses.length - n;
  showResult(true, `${sourceLabel || ""}${n}頭を読み取りました。` +
                   (scrN ? `（ほかに取消 ${scrN}頭）` : ""), lines);
  $("pasteText").value = "";
  setTimeout(() => $("horseList").scrollIntoView({behavior:"smooth", block:"start"}), 200);
}

/* ---------- PDF読込 ---------- */
async function importPdf(file){
  const status = $("pdfStatus");
  const lib = window.pdfjsLib;
  if(!lib){
    showResult(false, "PDFの読み取り機能を読み込めませんでした。", [
      "ページを再読み込みしてから、もう一度お試しください。"
    ]);
    return;
  }
  status.textContent = `${file.name} を読み取っています…`;
  $("importResult").hidden = true;

  try{
    const buf = await file.arrayBuffer();
    const r = await TurfPdf.pdfToText(new Uint8Array(buf), lib, (i, n) => {
      status.textContent = `${file.name} を読み取っています… ${i}/${n}ページ`;
    });
    status.textContent = `${file.name}（${r.pages}ページ）を読み取りました。`;

    if(!r.text.trim()){
      showResult(false, "PDFから文字を取り出せませんでした。", [
        "紙面をスキャンした画像だけのPDFの可能性があります。この場合、文字情報が入っていないため読み取れません。",
        "文字を選択できるPDFかどうか、PDFビューアで確認してください。",
        "画像しかない場合は、出馬表のページから文字をコピーして「貼り付け」タブをお使いください。"
      ]);
      return;
    }
    importPaste(r.text, `PDF（${r.pages}ページ）から`);
  }catch(e){
    status.textContent = "";
    showResult(false, "PDFを読めませんでした。", [
      e && e.message ? e.message : String(e),
      "パスワードで保護されたPDFや、壊れたファイルの可能性があります。"
    ]);
  }
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
$("policy").addEventListener("change", syncPolicyNote);
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
  renderJockeys();
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
$("btnImportClose3").addEventListener("click", closeImport);
$("btnImportClose4").addEventListener("click", closeImport);

/* ---------- 画像を参照用に表示する ----------
   ブラウザ内で日本語を文字起こしする実用的な手段がないため、画像から
   自動入力はしない。代わりに、入力しながら見比べられるように表示する。 */
let refUrl = null;
function showReference(file){
  if(refUrl) URL.revokeObjectURL(refUrl);
  refUrl = URL.createObjectURL(file);
  $("refImage").src = refUrl;
  $("refPanel").hidden = false;
  showResult(true, "画像を表示しました。", [
    "下の「参照画像」で拡大しながら、出走馬の欄に入力できます。",
    "端末の文字認識でテキストにできる場合は「貼り付け」タブの方が速く確実です（手順はこのタブの中にあります）。"
  ]);
  setTimeout(() => $("refPanel").scrollIntoView({behavior:"smooth", block:"start"}), 200);
}
$("imageFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(f) showReference(f);
});
$("btnRefClose").addEventListener("click", () => {
  $("refPanel").hidden = true;
  if(refUrl){ URL.revokeObjectURL(refUrl); refUrl = null; }
  $("refImage").removeAttribute("src");
});

// タブ切替
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const on = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b === btn));
    $("tabPaste").hidden = on !== "paste";
    $("tabPdf").hidden   = on !== "pdf";
    $("tabImage").hidden = on !== "image";
    $("tabJson").hidden  = on !== "json";
    $("importResult").hidden = true;
  });
});

$("jockeyList").addEventListener("click", e => {
  const name = e.target.dataset.suggest;
  if(!name) return;
  const v = Number(e.target.dataset.grade);
  jockeyRatings[name] = v;
  saveJockeys(jockeyRatings);
  horses.forEach(h => { if(h.jockeyName === name) h.jockey = v; });
  renderHorses();
  renderJockeys();
});
$("jockeyList").addEventListener("change", e => {
  const name = e.target.dataset.jockey;
  if(!name) return;
  const v = numOr(e.target.value, 3);
  jockeyRatings[name] = v;
  saveJockeys(jockeyRatings);
  horses.forEach(h => { if(h.jockeyName === name) h.jockey = v; });
  renderHorses();
  renderJockeys();
});
$("btnJockeyReset").addEventListener("click", () => {
  if(!confirm("記憶している騎手評価をすべて消します。よろしいですか？")) return;
  jockeyRatings = {};
  saveJockeys(jockeyRatings);
  renderJockeys();
});

// 画像を貼り付けた場合。ブラウザ内で日本語を文字起こしする手段がないため、
// 端末に入っている文字認識の使い方を案内する。
$("pasteText").addEventListener("paste", e => {
  const items = e.clipboardData && e.clipboardData.items;
  if(!items) return;
  let hasImage = false, hasText = false;
  for(const it of items){
    if(it.kind === "file" && /^image\//.test(it.type)) hasImage = true;
    if(it.kind === "string") hasText = true;
  }
  if(hasImage && !hasText){
    e.preventDefault();
    for(const it of items){
      if(it.kind === "file" && /^image\//.test(it.type)){
        const f = it.getAsFile();
        if(f){ showReference(f); return; }
      }
    }
    showResult(false, "画像は直接読み取れません。端末の文字認識をお使いください。", [
      "iPhone: 写真アプリでその画像を開き、右下の「テキスト認識表示」（枠に囲まれた文字のマーク）をタップ → 文字を長押し →「すべて選択」→「コピー」",
      "Android: Googleフォトやレンズでその画像を開き、テキストを選択 →「コピー」",
      "コピーできたら、この欄に貼り付けて「読み取る」を押してください。",
      "PDFで保存できる場合は「PDF」タブの方が確実です。"
    ]);
  }
});

$("btnPasteRun").addEventListener("click", () => importPaste($("pasteText").value));
$("pdfFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(f) importPdf(f);
});
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
syncPolicyNote();
addHorses(6);

/* ============================================================
   予想の記録
   保存した予想と、後から入れた着順を端末に残す。
   集計は TurfHistory（keiba/history.js）に委ねる。
   ============================================================ */
const HIST_KEY = "turf-logic-history-v1";
const TUNE_KEY = "turf-logic-tune-v1";

/* ============================================================
   記録から学んだ重み
   ------------------------------------------------------------
   着順を入れるたびに学習をやり直す。学習が採用されるのは、
   当てはめに使っていないレースで当てられ方が良くなったときだけ。
   採用されなければ既定のまま動く（＝悪くならない）。
   ============================================================ */
let tune = null;          // 採用中の重み。null なら既定
let lastLearn = null;     // 直近の学習結果（採用・見送りの理由を出すため）
let learnBusy = false;

function loadTune(){
  try{
    const o = JSON.parse(localStorage.getItem(TUNE_KEY) || "null");
    return (o && o.weights) ? o : null;
  }catch(e){ return null; }
}
function saveTune(t){
  try{
    if(t) localStorage.setItem(TUNE_KEY, JSON.stringify(t));
    else localStorage.removeItem(TUNE_KEY);
    return true;
  }catch(e){ return false; }
}
// 学習を使うかどうか（切っておけば既定の見方に戻る）
function tuneOn(){ return $("useTune") ? $("useTune").checked : true; }
function activeTune(){ return tuneOn() ? tune : null; }

const H = window.TurfHistory;

function loadHistory(){
  /* 更新のたびに記録の項目が増えるが、端末に残っている古い記録は
     その項目を持たない。normalize で形だけ揃える（中身は書き換えない）。
     読めない・壊れた記録があっても、他の記録は残す。 */
  let raw;
  try{ raw = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); }
  catch(e){
    // JSON として壊れている場合だけ、元データを退避してから空で始める
    try{ localStorage.setItem(HIST_KEY + "-broken", localStorage.getItem(HIST_KEY) || ""); }catch(e2){}
    return [];
  }
  return H.normalize(raw);
}
function saveHistory(list){
  try{ localStorage.setItem(HIST_KEY, JSON.stringify(list)); return true; }
  catch(e){
    alert("記録を保存できませんでした。端末の保存領域がいっぱいの可能性があります。\n" + e.message);
    return false;
  }
}
let history = loadHistory();
let lastRun = null;          // 直近の予想結果（記録ボタン用）

function fmtDate(ms){
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function trackName(k){ return (E.TRACKS[k] && E.TRACKS[k].name) || "不明"; }

/* ---------- 評価の目安の表 ---------- */
function renderGradeGuide(){
  $("gradeGuide").innerHTML =
    `<tr><th>評価</th><th>勝率の目安</th><th>目安の説明</th></tr>` +
    H.GRADE_GUIDE.map(g =>
      `<tr><td><b>${g.label}</b></td><td class="mono">${g.win}</td><td>${escapeHtml(g.note)}</td></tr>`
    ).join("");
}

/* ---------- 記録一覧 ---------- */
function renderHistory(){
  const sel = $("histTrack");
  const cur = sel.value || "all";
  const tracks = [];
  history.forEach(r => {
    const k = r.race && r.race.track;
    if(k && tracks.indexOf(k) < 0) tracks.push(k);
  });
  sel.innerHTML = `<option value="all">すべて</option>` +
    tracks.map(k => `<option value="${k}">${trackName(k)}</option>`).join("");
  sel.value = (cur === "all" || tracks.indexOf(cur) >= 0) ? cur : "all";

  const list = sel.value === "all" ? history
             : history.filter(r => r.race && r.race.track === sel.value);

  $("histEmpty").style.display = list.length ? "none" : "block";
  $("histCount").textContent = history.length ? `${history.length}件` : "";

  const s = H.raceStats(list);
  $("histStats").innerHTML = !s.done ? "" : [
    ["記録", `${s.done}/${s.total}件`, "着順を入れた件数"],
    ["◎の勝率", `${s.winPct}%`, `${s.win}/${s.done}`],
    ["◎の複勝率", `${s.showPct}%`, `${s.show}/${s.done}`],
    ["上位3頭に1着", `${s.top3Pct}%`, `${s.top3}/${s.done}`]
  ].map(([k, v, sub]) =>
    `<div class="stat-tile"><div class="k">${k}</div><div class="v mono">${v}</div><div class="s mono">${sub}</div></div>`
  ).join("");

  /* 荒れ度の読みが当たっているかの検算。
     「荒れやすい」と読んだレースが実際に荒れているかを見ないと、
     この指標を信用してよいか判断できない。 */
  const up = H.byUpset(list).filter(x => x.done > 0);
  $("upsetStats").innerHTML = !up.length ? "" :
    `<p class="hint" style="margin:0 0 6px">荒れ度の読みと実際（1着馬が予想4位以下、または${H.UPSET_ODDS}倍以上を「荒れた」とする）</p>` +
    up.map(x => `
      <div class="us-row">
        <span class="us-label">${escapeHtml(x.label)}</span>
        <span class="us-bar"><span style="width:${x.roughPct || 0}%"></span></span>
        <span class="us-num">荒れ ${x.roughPct}% ・ ◎勝率 ${x.winPct == null ? "-" : x.winPct + "%"} ・ ${x.done}件</span>
      </div>`).join("");

  $("histList").innerHTML = list.map(r => {
    const top = (r.pred && r.pred[0]) || {};
    const done = H.hasResult(r);
    const res = done ? `${r.result.first}-${r.result.second || "?"}-${r.result.third || "?"}` : "";
    const hit = done && top.num === r.result.first;
    const inShow = done && [r.result.first, r.result.second, r.result.third].indexOf(top.num) >= 0;
    const badge = !done ? `<span class="tag style">着順未入力</span>`
      : hit ? `<span class="tag value">◎的中</span>`
      : inShow ? `<span class="tag over">◎複勝圏</span>`
      : `<span class="tag style">◎圏外</span>`;
    return `
    <details class="hist" data-id="${escapeAttr(r.id)}">
      <summary>
        <span class="h-date mono">${fmtDate(r.savedAt)}</span>
        <span class="h-race">${trackName(r.race.track)} ${r.race.distance}m</span>
        <span class="h-top">◎${top.num || "-"} ${escapeHtml(top.name || "")}</span>
        ${badge}${done ? `<span class="h-res mono">${res}</span>` : ""}
      </summary>
      <div class="hist-body">
        <table class="hist-table">
          <tr><th>印</th><th>馬番</th><th>馬名</th><th>騎手</th><th>オッズ</th><th>勝率</th></tr>
          ${(r.pred || []).slice(0, 8).map((p, i) => `
            <tr${done && p.num === r.result.first ? ' class="won"' : ""}>
              <td>${i < E.MARKS.length ? E.MARKS[i] : i+1}</td>
              <td class="mono">${p.num}</td>
              <td>${escapeHtml(p.name || "")}</td>
              <td>${escapeHtml(p.jockeyName || "")}</td>
              <td class="mono">${p.odds}</td>
              <td class="mono">${(p.prob*100).toFixed(1)}%</td>
            </tr>`).join("")}
        </table>
        <div class="res-form">
          <span class="hint">着順（馬番）</span>
          <input type="number" min="0" max="18" placeholder="1着" data-res="first"  value="${done ? r.result.first  : ""}">
          <input type="number" min="0" max="18" placeholder="2着" data-res="second" value="${done && r.result.second ? r.result.second : ""}">
          <input type="number" min="0" max="18" placeholder="3着" data-res="third"  value="${done && r.result.third  ? r.result.third  : ""}">
          <button type="button" class="primary" data-act="save">結果を記録</button>
          <button type="button" class="danger" data-act="delete">削除</button>
        </div>
        <div class="review" hidden></div>
      </div>
    </details>`;
  }).join("");
}

$("histTrack").addEventListener("change", renderHistory);

$("histList").addEventListener("click", e => {
  const act = e.target.dataset.act;
  if(!act) return;
  const box = e.target.closest(".hist");
  const id = box.dataset.id;
  const r = history.find(x => x.id === id);
  if(!r) return;

  if(act === "delete"){
    if(!confirm("この記録を削除します。よろしいですか？")) return;
    history = history.filter(x => x.id !== id);
    saveHistory(history);
    renderHistory();
    renderJockeys();
    return;
  }
  const val = k => numOr(box.querySelector(`[data-res="${k}"]`).value, 0);
  const first = val("first");
  if(!(first >= 1 && first <= 18)){
    alert("1着の馬番を入れてください。");
    return;
  }
  r.result = {first: first, second: val("second"), third: val("third")};
  saveHistory(history);
  renderHistory();
  renderJockeys();
  showReview(r);
  autoRelearn();
});

/* ---------- 1レースの振り返り ----------
   着順を入れた直後に、そのレースで何を外したのかを出す。 */
function showReview(rec){
  const box = document.querySelector(`.hist[data-id="${rec.id}"] .review`);
  if(!box) return;
  const rv = LN.review(rec, activeTune());
  if(!rv){ box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="rv-head">振り返り</div>` +
    rv.lines.map(l => `<div class="rv-line">${escapeHtml(l)}</div>`).join("");
}

/* ============================================================
   学習パネル
   ============================================================ */
/* 学習は記録300件で1〜2秒（端末によってはその数倍）かかる。
   着順を1つ入れるたびに回すと、そのぶん画面が固まる。
   前回の学習から一定件数ぶん増えたときだけ自動でやり直し、
   すぐ反映したいときは「いま学習する」を押してもらう。 */
const RELEARN_EVERY = 5;

function autoRelearn(){
  const usable = LN.samples(history).length;
  if(usable < LN.MIN_RACES) return;
  const since = usable - (lastLearn && lastLearn.races != null ? lastLearn.races
                          : (tune ? tune.races : 0));
  if(lastLearn && since < RELEARN_EVERY) return;
  relearn();
}

function relearn(opt){
  if(learnBusy) return;
  learnBusy = true;
  const note = $("learnNote");
  if(note) note.textContent = "記録を数え直しています…";
  /* 記録が多いと数秒かかる。画面を描き替えてから計算に入る。 */
  setTimeout(() => {
    try{
      const out = LN.learn(history, {now: Date.now()});
      lastLearn = out;
      if(out.ok){
        tune = out.tune;
        saveTune(tune);
      } else if((opt && opt.clearOnFail) || out.reason === "few"){
        // 学ぶものが無い状態に戻ったら、既定の見方へ戻す
        if(out.reason === "few"){ tune = null; saveTune(null); }
      }
    } finally {
      learnBusy = false;
      renderLearn();
    }
  }, 30);
}

function renderLearn(){
  const panel = $("learnPanel");
  if(!panel) return;
  const usable = LN.samples(history).length;
  $("learnCount").textContent = `学習に使える記録 ${usable}件`;

  const on = tuneOn();
  $("learnState").className = "learn-state " + (tune && on ? "s-on" : "s-off");
  $("learnState").textContent = tune
    ? (on ? `${tune.races}レースから学習した見方で予想します` : "学習を切っています（既定の見方）")
    : "まだ学習していません（既定の見方）";

  const note = $("learnNote");
  if(lastLearn) note.textContent = lastLearn.message;
  else if(usable < LN.MIN_RACES)
    note.textContent = `着順まで入った記録が ${usable} レースです。` +
      `${LN.MIN_RACES} レースから学習を試し始めます。` +
      `実際に見方が変わるのは、たいてい100レース前後からです。`;
  else note.textContent = "「いま学習する」を押すと、記録から見方を当てはめ直します。";

  // 学んだ内容
  const lines = tune ? LN.explain(tune) : [];
  $("learnWeights").innerHTML = lines.length
    ? lines.map(x => `<li>${escapeHtml(x.text)}</li>`).join("")
    : "";
  $("learnWeights").hidden = !lines.length;

  // 市場に勝てているか
  const vm = LN.versusMarket(history, activeTune());
  const vmBox = $("learnVs");
  vmBox.hidden = !vm;
  if(vm){
    vmBox.innerHTML =
      `<div class="vs-row"><span>1位指名が1着</span>` +
      `<b class="mono">${(vm.ourWin*100).toFixed(1)}%</b>` +
      `<span class="vs-vs">対</span><span>1番人気</span>` +
      `<b class="mono">${(vm.favWin*100).toFixed(1)}%</b></div>` +
      `<div class="vs-note ${vm.beatsMarket ? "good" : "bad"}">` +
      (vm.beatsMarket
        ? "予想はオッズより当たっています。自分の見立てに寄せる価値があります。"
        : "予想はまだオッズを上回っていません。この状態では、オッズどおりに買うほうが正しくなります。") +
      `（${vm.races}レースで検算）</div>`;
  }

  // 較正（出した勝率と実際）
  const cal = LN.calibration(history, activeTune()).filter(c => c.n >= 20);
  const calBox = $("learnCal");
  calBox.hidden = !cal.length;
  if(cal.length){
    calBox.innerHTML =
      `<tr><th>推定勝率</th><th>頭数</th><th>出した</th><th>実際</th></tr>` +
      cal.map(c => `<tr>
        <td class="mono">${(c.from*100).toFixed(0)}〜${Math.min(100, c.to*100).toFixed(0)}%</td>
        <td class="mono">${c.n}</td>
        <td class="mono">${(c.expect*100).toFixed(1)}%</td>
        <td class="mono ${c.actual < c.expect * 0.75 ? "cal-over" : c.actual > c.expect * 1.3 ? "cal-under" : ""}">${(c.actual*100).toFixed(1)}%</td>
      </tr>`).join("");
  }
}

$("btnLearn") && $("btnLearn").addEventListener("click", () => relearn({clearOnFail:true}));
$("btnLearnReset") && $("btnLearnReset").addEventListener("click", () => {
  if(!confirm("学習した重みを消して、既定の見方に戻します。よろしいですか？\n（予想の記録は消えません。もう一度学習すれば戻せます）")) return;
  tune = null; lastLearn = null; saveTune(null); renderLearn();
});
$("useTune") && $("useTune").addEventListener("change", renderLearn);

/* ---------- 予想の保存 ---------- */
$("btnSaveRace").addEventListener("click", () => {
  if(!lastRun){ alert("先に予想してください。"); return; }
  const rec = H.makeRecord(lastRun.race, lastRun.rows, lastRun.bets, Date.now(),
                           lastRun.grade, lastRun.upset);
  history = H.addRecord(history, rec);
  if(!saveHistory(history)) return;
  $("saveNote").textContent = "記録しました。下の「予想の記録」から着順を入れられます。";
  renderHistory();
  renderDataPanel();
  autoBackup();
  $("historyPanel").scrollIntoView({behavior:"smooth", block:"start"});
});

renderGradeGuide();
renderHistory();
tune = loadTune();
renderLearn();

/* ============================================================
   データの保存（端末の外へ）
   ------------------------------------------------------------
   予想の記録も騎手評価も、ふだんは localStorage にしかない。
   履歴を消す・端末を替える・プライベートブラウズで開く——
   どれでも消える。貯めるほど価値が出るデータなので持ち出せるようにする。

   保存の手段は端末によって使えるものが違うため、3段構えにする。
     1) ファイルを直接指定して上書き保存（File System Access API）
        Android の Chrome・パソコン。Googleドライブ等のフォルダも選べる。
     2) 他のアプリへ送る（Web Share API）
        iPhone / iPad。ファイルApp・iCloud・メールなどへ渡せる。
     3) ダウンロード / 文字としてコピー
        どこでも動く最後の手段。
   ============================================================ */
const BK = window.TurfBackup;
const canPickFile = typeof window.showSaveFilePicker === "function";
const canShareFiles = !!(navigator.canShare && navigator.share);

/* 選んだ保存先（FileSystemFileHandle）は、次回も同じファイルへ書けるように覚えておく。
   ハンドルは JSON にできないので localStorage ではなく IndexedDB に置く。 */
const IDB_NAME = "turf-logic", IDB_STORE = "handles", HANDLE_KEY = "backup";

function idb(){
  return new Promise((resolve, reject) => {
    if(!window.indexedDB) return reject(new Error("indexedDB がありません"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if(!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(key, val){
  return idb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  })).catch(() => false);
}
function idbGet(key){
  return idb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  })).catch(() => null);
}
function idbDel(key){
  return idb().then(db => new Promise(resolve => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
  })).catch(() => false);
}

let backupHandle = null;

/* ---------- いまの端末のデータを集める / 書き戻す ---------- */
function collectStores(){
  const read = (key, fallback) => {
    try{ const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch(e){ return fallback; }
  };
  return {
    history: history,
    jockeys: jockeyRatings,
    jockeyNames: knownJockeyNames,
    state: read(STORAGE_KEY, null),
    tune: tune
  };
}

function applyStores(s){
  history = H.normalize(s.history || []);
  jockeyRatings = s.jockeys || {};
  knownJockeyNames = s.jockeyNames || [];
  if(s.tune !== undefined){ tune = (s.tune && s.tune.weights) ? s.tune : null; saveTune(tune); }
  saveHistory(history);
  saveJockeys(jockeyRatings);
  try{ localStorage.setItem(JOCKEY_NAMES_KEY, JSON.stringify(knownJockeyNames)); }catch(e){}
  if(s.state){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s.state)); }catch(e){}
  }
  renderHistory();
  renderJockeys();
  renderLearn();
}

function backupJson(){
  return JSON.stringify(BK.build(collectStores(), Date.now()), null, 1);
}

/* ---------- 表示 ---------- */
function dataResult(ok, title, lines){
  const box = $("dataResult");
  box.hidden = false;
  box.className = "import-result " + (ok ? "ok" : "ng");
  box.innerHTML = `<b>${escapeHtml(title)}</b>` +
    ((lines && lines.length) ? "<ul>" + lines.map(l => `<li>${escapeHtml(l)}</li>`).join("") + "</ul>" : "");
}

function renderDataPanel(){
  const s = collectStores();
  const n = (s.history || []).length;
  const j = Object.keys(s.jockeys || {}).length;
  $("dataCount").textContent = n || j ? `記録 ${n}件 ・ 騎手評価 ${j}人` : "まだデータがありません";

  const linked = !!backupHandle;
  $("linkState").textContent = linked ? backupHandle.name : "まだ決めていません";
  $("linkState").className = "data-v" + (linked ? " linked" : "");
  $("btnBackupNow").hidden = !linked;
  $("btnBackupUnlink").hidden = !linked;
  $("btnBackupSave").textContent = linked ? "保存先を選び直す" : "保存先を選んで保存";
  $("btnBackupSave").hidden = !canPickFile;
  $("btnBackupShare").hidden = !canShareFiles;
  $("linkNote").textContent = !canPickFile
    ? "この端末では保存先を指定できません。下の「ファイルに書き出す」か「他のアプリへ送る」を使ってください。"
    : linked
      ? "予想を記録するたびに、このファイルへ自動で上書きします。"
      : "Googleドライブや端末のフォルダを指定できます。一度決めれば以後は自動で上書きされます。";
}

/* ---------- 保存先を選ぶ ---------- */
async function chooseBackupFile(){
  try{
    const h = await window.showSaveFilePicker({
      suggestedName: BK.fileName(Date.now()),
      types: [{description: "Turf Logic のバックアップ", accept: {"application/json": [".json"]}}]
    });
    backupHandle = h;
    await idbPut(HANDLE_KEY, h);
    const ok = await writeBackup();
    renderDataPanel();
    if(ok) dataResult(true, `${h.name} に保存しました。`,
      ["これ以降、予想を記録するたびに同じファイルへ自動で上書きします。",
       "端末を替えるときは、このファイルを新しい端末で読み込んでください。"]);
  }catch(e){
    if(e && e.name === "AbortError") return;          // 利用者が選択をやめただけ
    dataResult(false, "保存先を指定できませんでした。", [String(e && e.message || e),
      "この端末では使えない場合があります。「ファイルに書き出す」をお試しください。"]);
  }
}

async function writeBackup(){
  if(!backupHandle) return false;
  try{
    if(backupHandle.queryPermission){
      let p = await backupHandle.queryPermission({mode:"readwrite"});
      if(p !== "granted" && backupHandle.requestPermission){
        p = await backupHandle.requestPermission({mode:"readwrite"});
      }
      if(p !== "granted") return false;
    }
    const w = await backupHandle.createWritable();
    await w.write(backupJson());
    await w.close();
    return true;
  }catch(e){
    return false;
  }
}

/* 記録を保存したあとに、保存先が決まっていれば自動で書き出す。
   ここで失敗しても予想の記録そのものは端末に残っているので、警告だけ出す。 */
async function autoBackup(){
  if(!backupHandle) return;
  const ok = await writeBackup();
  $("saveNote").textContent += ok
    ? `（${backupHandle.name} にも保存しました）`
    : "（バックアップ先に書き込めませんでした。データの保存から選び直してください）";
}

/* ---------- 書き出しの他の手段 ---------- */
function downloadBackup(){
  const blob = new Blob([backupJson()], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = BK.fileName(Date.now());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  dataResult(true, "ファイルに書き出しました。", [
    "端末のダウンロード先に保存されています。クラウドやパソコンへ移しておくと安全です。"
  ]);
}

async function shareBackup(){
  try{
    const name = BK.fileName(Date.now());
    const file = new File([backupJson()], name, {type:"application/json"});
    if(navigator.canShare && !navigator.canShare({files:[file]})){
      throw new Error("この端末ではファイルを送れません");
    }
    await navigator.share({files:[file], title:"Turf Logic のバックアップ"});
    dataResult(true, "他のアプリへ送りました。", [
      "ファイルApp・iCloudドライブ・Googleドライブなどに保存しておくと、あとから戻せます。"
    ]);
  }catch(e){
    if(e && e.name === "AbortError") return;
    dataResult(false, "送れませんでした。", [String(e && e.message || e),
      "「ファイルに書き出す」または「文字としてコピー」をお試しください。"]);
  }
}

async function copyBackup(){
  const text = backupJson();
  try{
    await navigator.clipboard.writeText(text);
    dataResult(true, "コピーしました。", [
      "メモアプリなどに貼り付けて保存してください。",
      "戻すときは、その文字を下の欄に貼り付けて「読み込む」を押します。"
    ]);
  }catch(e){
    $("backupText").value = text;
    dataResult(false, "自動でコピーできませんでした。", [
      "下の欄にバックアップの文字を入れました。長押しして全選択・コピーしてください。"
    ]);
  }
}

/* ---------- 戻す ---------- */
function restoreFrom(text){
  let obj;
  try{ obj = JSON.parse(text); }
  catch(e){
    dataResult(false, "読み込めませんでした。", ["ファイルの中身がバックアップの形ではありません。"]);
    return;
  }
  const v = BK.validate(obj);
  if(!v.ok){ dataResult(false, "読み込めませんでした。", [v.reason]); return; }

  const sum = BK.summarize(obj);
  const replaceMode = $("restoreReplace").checked;
  if(replaceMode){
    const now = collectStores();
    const msg = `いまの端末の記録 ${(now.history||[]).length}件 を消して、` +
                `バックアップの ${sum.history}件 に置き換えます。よろしいですか？`;
    if(!confirm(msg)) return;
  }

  const before = collectStores();
  const out = replaceMode ? BK.replace(obj) : BK.merge(before, obj, {restoreState: replaceMode});
  applyStores(out);
  backupText();

  const lines = [
    `予想の記録 ${out.history.length}件（${replaceMode ? "置き換え" : "＋" + out.added.history + "件"}）`,
    `騎手評価 ${Object.keys(out.jockeys).length}人（${replaceMode ? "置き換え" : "＋" + out.added.jockeys + "人"}）`
  ];
  if(sum.savedAt) lines.push("バックアップの日時: " + fmtDate(sum.savedAt));
  if(!replaceMode) lines.push("いまの端末にあった記録は消していません。");
  dataResult(true, "読み込みました。", lines);
  renderDataPanel();
}

function backupText(){
  $("backupText").value = "";
  $("backupFile").value = "";
  $("restoreReplace").checked = false;
}

/* ---------- 配線 ---------- */
$("btnDataToggle").addEventListener("click", () => {
  const b = $("dataBody");
  b.hidden = !b.hidden;
  $("btnDataToggle").textContent = b.hidden ? "開く" : "閉じる";
  if(!b.hidden) renderDataPanel();
});
$("btnBackupSave").addEventListener("click", chooseBackupFile);
$("btnBackupNow").addEventListener("click", async () => {
  const ok = await writeBackup();
  dataResult(ok, ok ? `${backupHandle.name} に上書き保存しました。` : "書き込めませんでした。",
    ok ? [] : ["保存先を選び直してください。ファイルが移動・削除された可能性があります。"]);
});
$("btnBackupUnlink").addEventListener("click", async () => {
  backupHandle = null;
  await idbDel(HANDLE_KEY);
  renderDataPanel();
  dataResult(true, "保存先を解除しました。", ["自動での上書きは行いません。"]);
});
$("btnBackupDownload").addEventListener("click", downloadBackup);
$("btnBackupShare").addEventListener("click", shareBackup);
$("btnBackupCopy").addEventListener("click", copyBackup);

$("backupFile").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const fr = new FileReader();
  fr.onload = () => restoreFrom(String(fr.result || ""));
  fr.onerror = () => dataResult(false, "ファイルを読めませんでした。", []);
  fr.readAsText(f);
});
$("btnRestoreRun").addEventListener("click", () => {
  const text = $("backupText").value.trim();
  if(!text){
    dataResult(false, "読み込むものがありません。", [
      "上のボタンからバックアップファイルを選ぶか、コピーした文字を貼り付けてください。"
    ]);
    return;
  }
  restoreFrom(text);
});

// 前回選んだ保存先を思い出す
idbGet(HANDLE_KEY).then(h => { if(h){ backupHandle = h; renderDataPanel(); } });
renderDataPanel();
