const fs=require('fs');
// 末尾の export{...} を グローバル代入に書き換えて、<script type="module"> で読めるようにする
function toGlobal(src, globalName){
  const m = src.match(/export\{([^}]*)\}\s*;?\s*$/);
  if(!m) throw new Error('export句が見つかりません: ' + globalName);
  const props = m[1].split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const as = pair.split(/\s+as\s+/);
    return as.length === 2 ? `${as[1]}:${as[0]}` : `${pair}:${pair}`;
  });
  return src.slice(0, m.index) + `globalThis.${globalName}={${props.join(',')}};\n`;
}
const B='node_modules/pdfjs-dist/legacy/build/';
fs.mkdirSync('/home/user/-/keiba/vendor',{recursive:true});
fs.writeFileSync('/home/user/-/keiba/vendor/pdf.worker.mjs',
  toGlobal(fs.readFileSync(B+'pdf.worker.min.mjs','utf8'), 'pdfjsWorker'));
fs.writeFileSync('/home/user/-/keiba/vendor/pdf.mjs',
  toGlobal(fs.readFileSync(B+'pdf.min.mjs','utf8'), 'pdfjsLib'));
const v=require('./node_modules/pdfjs-dist/package.json').version;
fs.writeFileSync('/home/user/-/keiba/vendor/README.md',
`# vendor

pdf.js（pdfjs-dist v${v}, Apache-2.0）を同梱しています。
PDFの出馬表からテキストを取り出すために使います。

末尾の \`export{...}\` を \`globalThis.pdfjsLib\` / \`globalThis.pdfjsWorker\` への
代入に書き換えてあります。これは以下のためです。

- 1ファイル完結のHTMLに埋め込めるようにする（ESMのexportは埋め込めない）
- \`globalThis.pdfjsWorker\` があると pdf.js はWorkerを起こさずメインスレッドで
  動く。アーティファクトのCSPは Worker と blob: URL を許可しないため、
  この経路でないと動作しない

更新するときは keiba/vendor/update.js を実行してください。
`);
fs.copyFileSync(__filename, '/home/user/-/keiba/vendor/update.js');
console.log('vendor 作成:', fs.readdirSync('/home/user/-/keiba/vendor').join(' '));
console.log('サイズ:', (fs.statSync('/home/user/-/keiba/vendor/pdf.mjs').size/1024).toFixed(0)+'KB',
            (fs.statSync('/home/user/-/keiba/vendor/pdf.worker.mjs').size/1024).toFixed(0)+'KB');
