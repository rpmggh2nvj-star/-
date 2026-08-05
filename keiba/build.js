#!/usr/bin/env node
/* ============================================================
   HTMLアプリのビルド
   ------------------------------------------------------------
   keiba/engine.js（予想ロジックの正）と keiba/ui/* を結合して、
   1ファイル完結のHTMLを2種類つくる。

     keiba-yosou.html    … ブラウザで直接開く単体版
     artifact-keiba.html … アーティファクト公開用（<head>等を持たない断片）
     docs/               … ブラウザアプリ（PWA）一式。GitHub Pages で配信する

   docs/ には index.html のほかに manifest とサービスワーカー、アイコンを置く。
   これを https で配信すると「ホーム画面に追加」でき、独立したアプリとして開き、
   通信が無くても動くようになる（file:// で開く単体版はここが使えない）。

   予想ロジックを直さないといけないときは engine.js だけを直し、
   node keiba/build.js を実行する。CLIとアプリが必ず同じ計算になる。
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(__dirname, p), "utf8");

const engine = read("engine.js");
const parser = read("parse.js");
const pdftext = read("pdftext.js");
const historyjs = read("history.js");
const backupjs = read("backup.js");
const style  = read("ui/style.html");
const body   = read("ui/body.html");
const app    = read("ui/app.js");

const banner = "/* このファイルは keiba/build.js が生成します。直接編集せず、" +
               "keiba/engine.js と keiba/ui/* を編集してください。 */";

const script = `<script>\n${banner}\n${engine}\n${parser}\n${pdftext}\n${historyjs}\n${backupjs}\n${app}\n</script>`;

// pdf.js は ESM のため type="module" で読み込む。
// worker を先に読ませて globalThis.pdfjsWorker を立てると、pdf.js は
// Worker を起こさずメインスレッドで動く（CSPが Worker と blob: を許可しないため）。
const pdfjs =
  `<script type="module">${read("vendor/pdf.worker.mjs")}</script>\n` +
  `<script type="module">${read("vendor/pdf.mjs")}</script>`;

// アーティファクト用：<!doctype> や <head> は公開時に付与されるため持たせない
const artifact = style + body + "\n" + pdfjs + "\n" + script + "\n";

// 単体版：そのままブラウザで開ける完全なHTML
const standalone =
`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>Turf Logic｜競馬予想アプリ</title>
${style}
</head>
<body>
${body}
${pdfjs}
${script}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "keiba-yosou.html"), standalone, "utf8");
fs.writeFileSync(path.join(ROOT, "artifact-keiba.html"), artifact, "utf8");

/* ============================================================
   ブラウザアプリ（PWA）一式
   ============================================================ */
const APP_NAME = "Turf Logic";
const APP_TITLE = "Turf Logic｜競馬予想アプリ";
const THEME = "#1F5C3D";

const manifest = {
  name: APP_TITLE,
  short_name: APP_NAME,
  description: "出馬表から指数・推定勝率・買い目を出す競馬予想アプリ。データは端末の中だけで扱います。",
  lang: "ja",
  dir: "ltr",
  start_url: "./",
  scope: "./",
  id: "./",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#F2F1EA",
  theme_color: THEME,
  categories: ["sports", "utilities"],
  icons: [
    {src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
    {src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
    {src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable"}
  ]
};

/* サービスワーカー。
   本体は1ファイルで完結しているので、最初に開いたときに一式を保存しておけば
   以後は通信が無くても起動する。更新は「まず保存済みを見せ、裏で取り直す」方式にし、
   起動の速さを優先する。取り直せたら次回の起動から新しくなる。

   キャッシュ名は中身のハッシュから作る。時刻から作るとビルドのたびに
   sw.js が変わって差分が汚れるうえ、中身が同じでも利用者に再取得させてしまう。 */
const CACHE = "turf-logic-" + require("crypto")
  .createHash("sha256").update(style + body + script).digest("hex").slice(0, 12);
const sw = `/* ${banner.slice(3, -3).trim()} */
const CACHE = ${JSON.stringify(CACHE)};
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
                "./icon-192.png", "./icon-512.png", "./icon-maskable.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  // 古い世代のキャッシュを消す
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => {
      const net = fetch(e.request).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;      // 保存済みがあれば即返し、裏で取り直す
    })
  );
});
`;

// PWA版の <head>。ホーム画面に追加したときの見え方はここで決まる。
const pwaHead = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${APP_TITLE}</title>
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="${THEME}">
<meta name="description" content="${manifest.description}">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<!-- iPhone / iPad はマニフェストを見ないので、個別に指定する -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${APP_NAME}">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">`;

const swRegister = `<script>
/* サービスワーカーの登録。https（または localhost）でのみ動く。
   登録できなくてもアプリ自体は普通に使えるので、失敗しても何もしない。 */
if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").catch(function(){});
  });
}
</script>`;

const pwaIndex =
`<!DOCTYPE html>
<html lang="ja">
<head>
${pwaHead}
${style}
</head>
<body>
${body}
${pdfjs}
${script}
${swRegister}
</body>
</html>
`;

/* リポジトリ直下の転送ページ。

   GitHub Pages の配信元が「/docs」か「/(root)」かで、アプリのURLが
   https://＜ユーザー＞.github.io/＜リポジトリ＞/ か .../docs/ に変わる。
   人に配るURLが設定次第で変わるのは具合が悪いので、直下に転送を置いて
   どちらの設定でも同じURLで開けるようにする。

   配信元が /docs のときはこのファイル自体が配信されないので、何も起きない。 */
const rootIndex =
`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${APP_TITLE}</title>
<link rel="canonical" href="docs/">
<meta http-equiv="refresh" content="0; url=docs/">
<style>
  body{font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;
       background:#F2F1EA;color:#22261F;display:grid;place-items:center;
       min-height:100vh;margin:0;padding:24px;text-align:center;line-height:1.8}
  a{color:#1F5C3D;font-weight:700;font-size:1.1rem}
</style>
</head>
<body>
  <div>
    <p>アプリを開いています…</p>
    <p><a href="docs/">開かない場合はこちらをタップ</a></p>
  </div>
  <script>location.replace("docs/");</script>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), rootIndex, "utf8");

const DOCS = path.join(ROOT, "docs");
fs.mkdirSync(DOCS, {recursive: true});
fs.writeFileSync(path.join(DOCS, "index.html"), pwaIndex, "utf8");
fs.writeFileSync(path.join(DOCS, "manifest.webmanifest"), JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(path.join(DOCS, "sw.js"), sw, "utf8");
// GitHub Pages が _ で始まる名前を除外しないようにする
fs.writeFileSync(path.join(DOCS, ".nojekyll"), "", "utf8");

const icons = require("./icon.js").icons();
Object.keys(icons).forEach(name => fs.writeFileSync(path.join(DOCS, name), icons[name]));

const kb = s => (s.length / 1024).toFixed(1) + "KB";
console.log("ビルド完了");
console.log("  keiba-yosou.html     " + kb(standalone));
console.log("  artifact-keiba.html  " + kb(artifact));
console.log("  docs/index.html      " + kb(pwaIndex) + "（＋ manifest / sw.js / アイコン3種）");
console.log("  index.html           " + kb(rootIndex) + "（docs/ への転送）");
