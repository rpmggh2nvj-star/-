/* ============================================================
   Turf Logic — データの書き出しと読み込み
   ------------------------------------------------------------
   このアプリのデータは端末の中（localStorage）にしかない。
   ブラウザの履歴を消す、端末を替える、プライベートブラウズで開く——
   どれでも消える。予想の記録や騎手評価は貯めるほど価値が出るので、
   端末の外へ持ち出せるようにする。

   ここでは「まとめる・確かめる・混ぜる」だけを行い、
   ファイルへの書き出しや保存先の選択はUI側が担当する。
   純粋な処理にしてあるので Node でもそのまま検証できる。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfBackup = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FORMAT = "turf-logic-backup";
  const FORMAT_VERSION = 1;

  /* 保存対象。key は localStorage のキー、kind は中身の形。
     新しい保存領域が増えたらここに足せば、書き出しにも復元にも入る。 */
  const STORES = [
    {name:"history",      key:"turf-logic-history-v1",      kind:"list",  label:"予想の記録"},
    {name:"jockeys",      key:"turf-logic-jockeys-v1",      kind:"map",   label:"騎手評価"},
    {name:"jockeyNames",  key:"turf-logic-jockey-names-v1", kind:"array", label:"騎手名の辞書"},
    {name:"state",        key:"turf-logic-state-v2",        kind:"value", label:"入力中のレース"}
  ];

  /* ---------- 書き出し ---------- */
  function build(data, now){
    const out = {
      format: FORMAT,
      version: FORMAT_VERSION,
      savedAt: now || 0,
      app: "Turf Logic",
      data: {}
    };
    STORES.forEach(s => {
      const v = data ? data[s.name] : null;
      out.data[s.name] = (v == null) ? defaultFor(s.kind) : v;
    });
    return out;
  }

  function defaultFor(kind){
    if(kind === "list" || kind === "array") return [];
    if(kind === "map") return {};
    return null;
  }

  // ファイル名。同じ日に何度も書き出しても上書きにならないよう時刻まで入れる。
  function fileName(now){
    const d = new Date(now || 0);
    const p = n => String(n).padStart(2, "0");
    return `turf-logic-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}` +
           `-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }

  /* ---------- 読み込み前の確認 ----------
     壊れたファイルや別アプリのJSONを読み込んで、
     いまのデータを壊してしまうことが最悪の事故なので、先に確かめる。 */
  function validate(obj){
    if(!obj || typeof obj !== "object" || Array.isArray(obj)){
      return {ok:false, reason:"バックアップファイルの形ではありません。"};
    }
    if(obj.format !== FORMAT){
      return {ok:false, reason:"このアプリのバックアップファイルではありません。"};
    }
    if(!(obj.version >= 1)){
      return {ok:false, reason:"バックアップの形式が読み取れません。"};
    }
    if(obj.version > FORMAT_VERSION){
      return {ok:false,
              reason:`新しい形式のバックアップです（形式 ${obj.version}）。アプリを更新してから読み込んでください。`};
    }
    if(!obj.data || typeof obj.data !== "object"){
      return {ok:false, reason:"バックアップに中身がありません。"};
    }
    const bad = STORES.find(s => {
      const v = obj.data[s.name];
      if(v == null) return false;                       // 無いのは許す（既定値で埋める）
      if(s.kind === "list" || s.kind === "array") return !Array.isArray(v);
      if(s.kind === "map") return typeof v !== "object" || Array.isArray(v);
      return false;
    });
    if(bad) return {ok:false, reason:`「${bad.label}」の形が壊れています。`};
    return {ok:true, reason:""};
  }

  /* ---------- 中身の要約 ----------
     読み込む前に「何がどれだけ入っているか」を見せて、
     取り違えたファイルを復元してしまうのを防ぐ。 */
  function summarize(obj){
    const d = (obj && obj.data) || {};
    const n = v => Array.isArray(v) ? v.length : (v && typeof v === "object") ? Object.keys(v).length : 0;
    return {
      savedAt: obj && obj.savedAt || 0,
      history: n(d.history),
      jockeys: n(d.jockeys),
      jockeyNames: n(d.jockeyNames),
      hasState: !!d.state
    };
  }

  /* ---------- 混ぜる ----------
     復元は既定で「足す」。いまの端末にある記録を消さずに、
     バックアップにしかない記録を加える。

     ・予想の記録は id で重ねる。同じ id なら、着順が入っている方を残す
       （着順を入れたあとにバックアップを取り直していない場合に備える）。
       どちらも同条件なら保存が新しい方。
     ・騎手評価は、いまの端末の値を優先する（手で直した直後を上書きしない）。
     ・騎手名の辞書は和集合。
     ・入力中のレースは、指定されたときだけ差し替える。 */
  function merge(current, incoming, opts){
    opts = opts || {};
    const cur = current || {};
    const inc = (incoming && incoming.data) || {};
    const added = {history:0, jockeys:0, jockeyNames:0};

    // 予想の記録
    const byId = {};
    const order = [];
    const put = (r, isCurrent) => {
      if(!r || !r.id) return;
      const old = byId[r.id];
      if(!old){ byId[r.id] = r; order.push(r.id); if(!isCurrent) added.history++; return; }
      byId[r.id] = pickRecord(old, r);
    };
    (cur.history || []).forEach(r => put(r, true));
    (inc.history || []).forEach(r => put(r, false));
    const history = order.map(id => byId[id])
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    // 騎手評価（同じ騎手が両方にあれば、いまの端末の値を残す）
    const curJk = cur.jockeys || {}, incJk = inc.jockeys || {};
    const jockeys = {};
    Object.keys(incJk).forEach(k => { jockeys[k] = incJk[k]; });
    Object.keys(curJk).forEach(k => { jockeys[k] = curJk[k]; });
    Object.keys(incJk).forEach(k => { if(!(k in curJk)) added.jockeys++; });

    // 騎手名の辞書（和集合）
    const names = (cur.jockeyNames || []).slice();
    const seen = new Set(names);
    (inc.jockeyNames || []).forEach(x => {
      if(x && !seen.has(x)){ seen.add(x); names.push(x); added.jockeyNames++; }
    });

    return {
      history: history,
      jockeys: jockeys,
      jockeyNames: names,
      state: opts.restoreState && inc.state ? inc.state : (cur.state || null),
      added: added
    };
  }

  /* 同じ id の記録が2つあるときの選び方。
     着順が入っている方が情報として上。両方入っていれば保存が新しい方。 */
  function pickRecord(a, b){
    const done = r => !!(r && r.result && r.result.first);
    if(done(a) !== done(b)) return done(a) ? a : b;
    return (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
  }

  /* 置き換え（バックアップの内容でそっくり入れ替える）。
     取り違えると戻せないので、UI側で必ず確認を取ること。 */
  function replace(incoming){
    const inc = (incoming && incoming.data) || {};
    return {
      history: inc.history || [],
      jockeys: inc.jockeys || {},
      jockeyNames: inc.jockeyNames || [],
      state: inc.state || null,
      added: {history: (inc.history || []).length,
              jockeys: Object.keys(inc.jockeys || {}).length,
              jockeyNames: (inc.jockeyNames || []).length}
    };
  }

  return {
    FORMAT, FORMAT_VERSION, STORES,
    build, fileName, validate, summarize, merge, replace, pickRecord
  };
});
