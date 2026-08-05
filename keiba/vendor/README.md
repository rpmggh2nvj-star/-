# vendor

pdf.js（pdfjs-dist v6.2.108, Apache-2.0）を同梱しています。
PDFの出馬表からテキストを取り出すために使います。

末尾の `export{...}` を `globalThis.pdfjsLib` / `globalThis.pdfjsWorker` への
代入に書き換えてあります。これは以下のためです。

- 1ファイル完結のHTMLに埋め込めるようにする（ESMのexportは埋め込めない）
- `globalThis.pdfjsWorker` があると pdf.js はWorkerを起こさずメインスレッドで
  動く。アーティファクトのCSPは Worker と blob: URL を許可しないため、
  この経路でないと動作しない

更新するときは keiba/vendor/update.js を実行してください。
