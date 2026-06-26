// 本文（Zen Maru Gothic Medium）とコード（Fira Mono）を、サイトで実際に使う文字だけに
// サブセットして public/fonts/*.woff2 として書き出す。
//
// 以前は Google Fonts の外部 CSS を <head> でレンダリングブロッキング読み込みしていた。
// 日本語フォントは全部入りだと数十 MB と巨大なので、投稿（post/*.md）と UI 文言
// （src/**/*.astro）に出現する文字だけへ pyftsubset で絞り込み、同一オリジンの小さな
// woff2 にして第三者へのラウンドトリップを無くす。
//
// 生成物（public/fonts/*.woff2）はリポジトリにコミットする。サブセットは「使用文字が
// 増えたとき」だけ作り直せばよいので prebuild には含めず、`npm run generate:fonts` で
// 手動実行する（CI に巨大なソース TTF やフォントツールを要求しないため）。ソース TTF は
// scripts/.fontsrc/ にキャッシュし、無ければ Google Fonts のリポジトリから取得する。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(__dirname, ".fontsrc");
const outDir = join(root, "public", "fonts");
mkdirSync(srcDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// --- 1. サイトでレンダリングされる文字を集める ---------------------------------
// 本文・コード・フロントマター（post/*.md）と、テーマ切替やコピーボタン等の UI 文言
// （src 配下の .astro / .ts）を対象にする。多少の追記で欠字が出ないよう、後段で
// かな・記号の連続範囲も併せて含める。
function readAllText(dir, exts) {
  let text = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) text += readAllText(p, exts);
    else if (exts.some((e) => entry.name.endsWith(e))) text += readFileSync(p, "utf8");
  }
  return text;
}

const corpus =
  readAllText(join(root, "post"), [".md"]) +
  readAllText(join(root, "src"), [".astro", ".ts"]) +
  // レイアウト既定のタイトル等、念のための定数。
  "Dispositif";

const chars = [...new Set(corpus)].filter((c) => c >= " ").sort().join("");

// 連続範囲で必ず含めるコードポイント（欠字でフォールバックしないよう保険的に確保）。
// ASCII / Latin-1 / 一般句読点の一部 / CJK 記号 / ひらがな / カタカナ / 全角英数記号。
const baseUnicodes = [
  "U+0020-007E", // ASCII
  "U+00A0-00FF", // Latin-1 補助
  "U+2010-2027", // ダッシュ・引用符・三点リーダ等
  "U+2030-205E", // ‰ † 等
  "U+2190-21FF", // 矢印
  "U+2200-22FF", // 数学演算子（本文中の記号）
  "U+3000-303F", // CJK 記号・句読点
  "U+3040-309F", // ひらがな
  "U+30A0-30FF", // カタカナ
  "U+FF00-FFEF", // 半角・全角形
].join(",");

// --- 2. ソース TTF を用意（無ければ取得） --------------------------------------
async function ensureSource(file, urls) {
  const dest = join(srcDir, file);
  if (existsSync(dest) && statSync(dest).size > 50_000) return dest;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 50_000) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(dest, buf);
        console.log(`[generate-fonts] downloaded ${file} (${buf.length} bytes)`);
        return dest;
      }
    } catch {
      /* 次の URL を試す */
    }
  }
  throw new Error(`source font not found and could not be downloaded: ${file}`);
}

const zmgSrc = await ensureSource("ZenMaruGothic-Medium.ttf", [
  "https://github.com/googlefonts/zen-marugothic/raw/main/fonts/ttf/ZenMaruGothic-Medium.ttf",
  "https://raw.githubusercontent.com/googlefonts/zen-marugothic/main/fonts/ttf/ZenMaruGothic-Medium.ttf",
]);
const firaSrc = await ensureSource("FiraMono-Regular.ttf", [
  "https://github.com/mozilla/Fira/raw/master/ttf/FiraMono-Regular.ttf",
  "https://raw.githubusercontent.com/mozilla/Fira/master/ttf/FiraMono-Regular.ttf",
]);

// --- 3. pyftsubset でサブセット woff2 を生成 -----------------------------------
function subset(src, out, { text, unicodes }) {
  const args = [
    src,
    `--output-file=${out}`,
    "--flavor=woff2",
    "--layout-features=*", // 日本語の合字・カーニング等の必須フィーチャを保持
    "--no-hinting",
    "--desubroutinize",
    `--unicodes=${unicodes}`,
  ];
  // 使用文字は --text で直接渡す（範囲外の漢字などを個別に拾う）。
  if (text) args.push(`--text=${text}`);
  execFileSync("pyftsubset", args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`[generate-fonts] wrote ${out} (${statSync(out).size} bytes)`);
}

// 本文フォント：使用文字 + かな/記号の保険範囲。
subset(zmgSrc, join(outDir, "zen-maru-gothic-medium.woff2"), {
  text: chars,
  unicodes: baseUnicodes,
});

// コードフォント：コード中に現れる ASCII 記号が中心。本文 corpus にコードフェンスの
// 中身も含まれるので、同じ text を渡しつつ ASCII/Latin-1 を範囲で確保する。
subset(firaSrc, join(outDir, "fira-mono-regular.woff2"), {
  text: chars,
  unicodes: "U+0020-007E,U+00A0-00FF,U+2010-2027",
});

console.log(`[generate-fonts] subset from ${chars.length} unique chars`);
