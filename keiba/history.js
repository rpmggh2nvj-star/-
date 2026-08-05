/* ============================================================
   Turf Logic — 予想の記録と集計
   ------------------------------------------------------------
   保存した予想と、後から入れた着順から成績を集計する。
   保存そのものはUI側（localStorage）が担当し、
   ここは受け取った記録を数えるだけの純粋な処理にしてある。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfHistory = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_RECORDS = 300;      // 端末の保存領域を圧迫しないための上限

  /* 騎手評価の目安。
     勝率は競馬全体でおおむね「リーディング上位20%超・平均7%前後」。
     記録が貯まるまでは、この目安を手がかりに手でつける。 */
  const GRADE_GUIDE = [
    {v:5, label:"S", win:"20%以上",  note:"リーディング上位。どの馬でも上位に持ってくる"},
    {v:4, label:"A", win:"13〜20%", note:"常時上位。有力馬を任される"},
    {v:3, label:"B", win:"7〜13%",  note:"平均的。既定値はここ"},
    {v:2, label:"C", win:"3〜7%",   note:"やや下位。人気馬に乗る機会が少ない"},
    {v:1, label:"D", win:"3%未満",  note:"経験が浅い、または減量騎手"}
  ];

  const MIN_RIDES = 10;         // これ未満の騎乗数では評価を提案しない

  /* ---------- 古い記録の読み直し ----------
     アプリを更新すると、記録に無かった項目（レース評価・荒れ度など）が増える。
     すでに端末へ保存されている記録は、その項目を持たないまま残っている。
     読み込み時にここを通し、欠けている項目を既定値で埋めて形を揃える。

     方針は「消さない・書き換えない」。判別できない項目は null のままにし、
     集計側が null を無視できるようにしてある。過去の記録を作り直したり、
     新しい基準で判定し直したりはしない（当時の予想は当時のまま残す）。 */
  function normalizeRecord(r){
    if(!r || typeof r !== "object") return null;
    if(!r.id || !r.savedAt) return null;                 // 記録として成立しないもの
    const out = {
      id: String(r.id),
      savedAt: Number(r.savedAt) || 0,
      grade: r.grade || null,                            // v1 の記録には無い
      upset: r.upset || null,                            // v1 の記録には無い
      race: r.race || {},
      pred: Array.isArray(r.pred) ? r.pred : [],
      bets: Array.isArray(r.bets) ? r.bets : [],
      result: r.result && r.result.first ? r.result : null
    };
    return out;
  }

  function normalize(records){
    if(!Array.isArray(records)) return [];
    return records.map(normalizeRecord).filter(Boolean);
  }

  function hasResult(r){
    return !!(r && r.result && r.result.first);
  }
  function placings(r){
    return [r.result.first, r.result.second, r.result.third].filter(n => n > 0);
  }

  /* ---------- レース単位の成績 ---------- */
  function raceStats(records){
    const done = (records || []).filter(hasResult);
    const s = {total: (records || []).length, done: done.length,
               win: 0, show: 0, top3: 0, hitBets: 0};
    done.forEach(r => {
      const pred = r.pred || [];
      const honmei = pred[0];
      if(!honmei) return;
      const p = placings(r);
      if(honmei.num === r.result.first) s.win++;         // ◎が1着
      if(p.indexOf(honmei.num) >= 0) s.show++;           // ◎が3着以内
      const top3 = pred.slice(0, 3).map(x => x.num);
      if(top3.indexOf(r.result.first) >= 0) s.top3++;    // ◎○▲のどれかが1着
    });
    const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
    s.winPct  = pct(s.win, s.done);
    s.showPct = pct(s.show, s.done);
    s.top3Pct = pct(s.top3, s.done);
    return s;
  }

  /* ---------- 実際に荒れたかどうか ----------
     予想の当たり外れとは別に、そのレースが荒れたかを結果から判定する。
     「1着馬を予想の上位3頭に入れられなかった」または
     「1着馬が10倍以上の人気薄だった」ときを荒れたレースとする。 */
  const UPSET_ODDS = 10;

  function wasUpset(r){
    if(!hasResult(r)) return null;
    const pred = r.pred || [];
    const winner = pred.find(p => p.num === r.result.first);
    if(!winner) return true;                        // 予想に無い馬が勝った
    return winner.rank > 3 || winner.odds >= UPSET_ODDS;
  }

  /* ---------- 荒れ度ごとの成績 ----------
     「荒れると読んだレースで実際に荒れたか」「そのとき当てられたか」を見る。
     予測が当たっているかを確かめられないと、荒れ度の指標を信用してよいか
     判断できないため。記録に荒れ度が無い（更新前の）ものは対象外にする。 */
  function byUpset(records){
    const levels = [
      {level:"low",  label:"堅い"},
      {level:"mid",  label:"やや荒れる"},
      {level:"high", label:"荒れやすい"}
    ];
    return levels.map(L => {
      const list = (records || []).filter(r => r.upset && r.upset.level === L.level);
      const done = list.filter(hasResult);
      const rough = done.filter(wasUpset).length;
      const s = raceStats(list);
      return {
        level: L.level, label: L.label,
        total: list.length, done: done.length,
        rough: rough,
        roughPct: done.length ? Math.round(rough / done.length * 1000) / 10 : null,
        winPct: s.winPct, top3Pct: s.top3Pct
      };
    }).filter(x => x.total > 0);
  }

  /* ---------- 競馬場ごとの内訳 ---------- */
  function byTrack(records){
    const map = {};
    (records || []).forEach(r => {
      const k = (r.race && r.race.track) || "unknown";
      (map[k] = map[k] || []).push(r);
    });
    return Object.keys(map).map(k => ({
      track: k, records: map[k], stats: raceStats(map[k])
    })).sort((a, b) => b.records.length - a.records.length);
  }

  /* ---------- 騎手ごとの成績 ----------
     予想に載っている全馬の騎手を数える。◎を付けた馬だけでなく
     出走馬すべてを対象にすることで、予想の当たり外れとは独立した
     「その騎手の成績」になる。 */
  function jockeyStats(records){
    const map = {};
    (records || []).filter(hasResult).forEach(r => {
      const first = r.result.first, second = r.result.second, third = r.result.third;
      (r.pred || []).forEach(p => {
        if(!p.jockeyName) return;
        const s = map[p.jockeyName] ||
          (map[p.jockeyName] = {name: p.jockeyName, rides: 0, win: 0, quinella: 0, show: 0});
        s.rides++;
        if(p.num === first){ s.win++; s.quinella++; s.show++; }
        else if(p.num === second){ s.quinella++; s.show++; }
        else if(p.num === third){ s.show++; }
      });
    });
    const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
    return Object.keys(map).map(k => {
      const s = map[k];
      s.winPct = pct(s.win, s.rides);
      s.quinellaPct = pct(s.quinella, s.rides);
      s.showPct = pct(s.show, s.rides);
      s.suggested = suggestGrade(s);
      return s;
    }).sort((a, b) => b.rides - a.rides || b.winPct - a.winPct);
  }

  /* 騎乗数が少ないうちは提案しない。数レースの勝率はほとんど偶然で決まる。 */
  function suggestGrade(s){
    if(!s || s.rides < MIN_RIDES) return null;
    const w = s.win / s.rides;
    if(w >= 0.20) return 5;
    if(w >= 0.13) return 4;
    if(w >= 0.07) return 3;
    if(w >= 0.03) return 2;
    return 1;
  }

  /* ---------- 保存用のレコードを組み立てる ---------- */
  function makeRecord(race, rows, bets, now, grade, upset){
    return {
      id: "r" + now,
      savedAt: now,
      // 「買うべきレースだったか」「荒れると読んだか」もあとから振り返れるように残す
      grade: grade ? {grade: grade.grade, title: grade.title,
                      bestEv: Math.round(grade.bestEv * 100) / 100} : null,
      upset: upset ? {score: upset.score, level: upset.level, label: upset.label} : null,
      race: {
        track: race.track, surface: race.surface, course: race.course,
        distance: race.distance, condition: race.condition,
        pace: race.pace, budget: race.budget,
        name: race.name || "", raceNo: race.raceNo || null
      },
      pred: rows.map((x, i) => ({
        rank: i + 1,
        num: x.h.num,
        name: x.h.name || "",
        jockeyName: x.h.jockeyName || "",
        style: x.h.style,
        odds: x.h.odds,
        score: Math.round(x.score * 10) / 10,
        prob: Math.round(x.prob * 10000) / 10000,
        ev: Math.round(x.ev * 100) / 100,
        edge: Math.round(x.edge * 100) / 100
      })),
      bets: (bets || []).map(b => ({
        name: b.name, combos: b.combos, unit: b.unit, total: b.total
      })),
      result: null
    };
  }

  /* 新しいものを先頭に。上限を超えたら古いものから捨てる。 */
  function addRecord(records, rec){
    const list = [rec].concat(records || []);
    return list.slice(0, MAX_RECORDS);
  }

  return {
    MAX_RECORDS, MIN_RIDES, GRADE_GUIDE, UPSET_ODDS,
    raceStats, byTrack, byUpset, jockeyStats, suggestGrade,
    makeRecord, addRecord, hasResult, wasUpset, normalize, normalizeRecord
  };
});
