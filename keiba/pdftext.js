/* ============================================================
   Turf Logic — PDFからのテキスト取り出し
   ------------------------------------------------------------
   pdf.js が返すテキスト要素には座標が付いている。
   それを使って「同じ高さにある要素＝同じ行」としてまとめ直し、
   左から右へ並べることで、元の表の行を復元する。

   単純に読み出し順で連結すると列がばらばらになりがちだが、
   座標で組み直せば通常の出馬表と同じ形になり、
   既存のパーサーがそのまま使える。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfPdf = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 同じ行とみなす縦方向のずれ。文字の高さに応じて決める。
  function rowTolerance(items){
    const hs = items.map(it => it.height || 0).filter(h => h > 0).sort((a,b) => a-b);
    const median = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
    return Math.max(2, median * 0.6);
  }

  function itemsToLines(items){
    const use = items.filter(it => it && typeof it.str === "string" && it.str.trim());
    if(!use.length) return "";
    const tol = rowTolerance(use);

    const rows = [];
    use.forEach(it => {
      const x = it.transform[4], y = it.transform[5];
      // 近い行を探す。複数あれば最も近いものへ入れる。
      let best = null, bestD = Infinity;
      for(const r of rows){
        const d = Math.abs(r.y - y);
        if(d <= tol && d < bestD){ best = r; bestD = d; }
      }
      if(!best){ best = {y: y, cells: []}; rows.push(best); }
      best.cells.push({x: x, s: it.str, w: it.width || 0, h: it.height || 0});
    });

    rows.sort((a, b) => b.y - a.y);                   // 上の行から
    return rows.map(r =>
      r.cells.sort((a, b) => a.x - b.x).map(c => c.s.trim()).filter(Boolean).join("\t")
    ).filter(Boolean).join("\n");
  }

  /* pdf.js のドキュメントから全ページ分のテキストを取り出す。
     pdfjsLib は呼び出し側から渡す（ブラウザは埋め込み、CLIは同梱ファイル）。 */
  async function pdfToText(data, pdfjsLib, onProgress){
    const doc = await pdfjsLib.getDocument({
      data: data,
      useSystemFonts: true,
      isEvalSupported: false        // CSPの厳しい環境でも動くようにする
    }).promise;

    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out.push(itemsToLines(tc.items));
      if(onProgress) onProgress(i, doc.numPages);
    }
    const text = out.filter(Boolean).join("\n");
    return {text: text, pages: doc.numPages};
  }

  return {itemsToLines, pdfToText, rowTolerance};
});
