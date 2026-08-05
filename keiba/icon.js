/* ============================================================
   Turf Logic — アプリアイコンの生成
   ------------------------------------------------------------
   ホーム画面に置くには PNG のアイコンが要る。画像ファイルを
   リポジトリに置くと中身が読めず、直すたびに差し替えが必要になるので、
   図形の定義から毎回描き起こす。外部ライブラリは使わない
   （PNG は Node 標準の zlib だけで書ける）。

   絵柄は、芝色の角丸に金色のコースの楕円。
   ============================================================ */
"use strict";
const zlib = require("zlib");

/* ---------- PNG の組み立て ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = -1;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data){
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// RGBA のピクセル配列（Uint8Array, 幅×高さ×4）を PNG にする
function toPng(width, height, rgba){
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // ビット深度
  ihdr[9] = 6;      // カラータイプ RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // 各行の先頭にフィルタ種別（0＝なし）を置く
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for(let y = 0; y < height; y++){
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy
      ? rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4))
          .copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, {level: 9})),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- 絵柄 ---------- */
const TURF   = [0x1F, 0x5C, 0x3D];   // 芝色（アプリの見出しと同じ）
const DEEP   = [0x12, 0x3A, 0x26];
const GOLD   = [0xB9, 0x8C, 0x1E];
const SAND   = [0xF2, 0xF1, 0xEA];

/* padding は「余白の割合」。maskable 用に絵柄を内側へ寄せるときに使う
   （端末が角を大きく丸めても、コースの楕円が欠けないようにするため）。 */
function draw(size, opts){
  opts = opts || {};
  const pad = opts.padding || 0;          // 0〜0.5
  const round = opts.round == null ? 0.22 : opts.round;
  const px = Buffer.alloc(size * size * 4);

  const R = size * round;                 // 角丸の半径
  const cx = size / 2, cy = size / 2;
  const inner = size * (1 - pad * 2);     // 絵柄に使える範囲

  // コースの楕円（外周・内周）。太さは絵柄範囲に比例させる。
  const ax = inner * 0.34, ay = inner * 0.26;     // 外周の半径
  const w  = inner * 0.085;                        // コースの幅
  const bx = ax - w, by = ay - w;                  // 内周の半径

  const put = (i, c, a) => {
    px[i] = c[0]; px[i+1] = c[1]; px[i+2] = c[2]; px[i+3] = a;
  };

  // 角丸の内側かどうか（4隅は円で判定）
  const inRounded = (x, y) => {
    const lx = Math.min(x, size - 1 - x), ly = Math.min(y, size - 1 - y);
    if(lx >= R || ly >= R) return true;
    const dx = R - lx, dy = R - ly;
    return dx*dx + dy*dy <= R*R;
  };

  // 1点の色を求める。境界を滑らかにするため、1画素につき複数点を平均する。
  const sample = (x, y) => {
    if(opts.square !== true && !inRounded(x, y)) return [0, 0, 0, 0];   // 角の外は透明
    const t = y / size;                                   // 背景は下へいくほど濃い芝色
    const bg = [
      TURF[0] + (DEEP[0] - TURF[0]) * t,
      TURF[1] + (DEEP[1] - TURF[1]) * t,
      TURF[2] + (DEEP[2] - TURF[2]) * t
    ];
    const nx = x - cx, ny = y - cy;
    const outer  = (nx*nx)/(ax*ax) + (ny*ny)/(ay*ay);
    const innerE = (nx*nx)/(bx*bx) + (ny*ny)/(by*by);
    if(innerE < 1)               return [SAND[0], SAND[1], SAND[2], 255];  // コースの内側
    if(outer <= 1)               return [GOLD[0], GOLD[1], GOLD[2], 255];  // コース
    return [bg[0], bg[1], bg[2], 255];
  };

  const SS = 3;                                            // 1辺あたりの標本数
  for(let y = 0; y < size; y++){
    for(let x = 0; x < size; x++){
      let r = 0, g = 0, b = 0, a = 0;
      for(let sy = 0; sy < SS; sy++){
        for(let sx = 0; sx < SS; sx++){
          const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          // 透明部分の色は混ぜない（縁が黒ずむのを防ぐ）
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (y * size + x) * 4;
      if(a === 0){ put(i, [0,0,0], 0); continue; }
      put(i, [Math.round(r/a), Math.round(g/a), Math.round(b/a)], Math.round(a / (SS*SS)));
    }
  }
  return toPng(size, size, px);
}

function icons(){
  return {
    "icon-192.png":      draw(192),
    "icon-512.png":      draw(512),
    // maskable は端末が好きな形に切り抜くので、余白を多めに取り四角で描く
    "icon-maskable.png": draw(512, {padding: 0.12, round: 0, square: true})
  };
}

module.exports = {toPng, draw, icons, crc32};

// 直接実行したときは、その場に書き出して目で確かめられるようにする
if(require.main === module){
  const fs = require("fs");
  const out = process.argv[2] || ".";
  const list = icons();
  Object.keys(list).forEach(name => {
    fs.writeFileSync(require("path").join(out, name), list[name]);
    console.log(name, list[name].length + " bytes");
  });
}
