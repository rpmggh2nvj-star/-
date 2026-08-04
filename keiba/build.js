#!/usr/bin/env node
/* ============================================================
   HTMLアプリのビルド
   ------------------------------------------------------------
   keiba/engine.js（予想ロジックの正）と keiba/ui/* を結合して、
   1ファイル完結のHTMLを2種類つくる。

     keiba-yosou.html    … ブラウザで直接開く単体版
     artifact-keiba.html … アーティファクト公開用（<head>等を持たない断片）

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
const style  = read("ui/style.html");
const body   = read("ui/body.html");
const app    = read("ui/app.js");

const banner = "/* このファイルは keiba/build.js が生成します。直接編集せず、" +
               "keiba/engine.js と keiba/ui/* を編集してください。 */";

const script = `<script>\n${banner}\n${engine}\n${parser}\n${app}\n</script>`;

// アーティファクト用：<!doctype> や <head> は公開時に付与されるため持たせない
const artifact = style + body + "\n" + script + "\n";

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
${script}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "keiba-yosou.html"), standalone, "utf8");
fs.writeFileSync(path.join(ROOT, "artifact-keiba.html"), artifact, "utf8");

const kb = s => (s.length / 1024).toFixed(1) + "KB";
console.log("ビルド完了");
console.log("  keiba-yosou.html     " + kb(standalone));
console.log("  artifact-keiba.html  " + kb(artifact));
