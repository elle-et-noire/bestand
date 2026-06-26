// 背景の「目玉」パターンを決定論的に生成し、retro/dark の 2 テーマぶんを
// public/bg-retro.svg / public/bg-dark.svg として書き出す。
//
// かつては BackgroundPattern.astro が同じ SVG を data URI 化して全ページの HTML に
// インラインしていた（2 テーマ分で各ページ約 45KB／ページ遷移ごとに再取得）。
// 固定シードゆえ出力は毎回同一なので、ビルド前に一度だけファイル化しておけば
// ブラウザは一度取得すれば全ページでキャッシュでき、HTML 本体も軽くなる。
//
// このスクリプトが生成ロジックの単一の源泉。package.json の prebuild/predev から
// 実行され、astro の public/ コピーより前に出力ファイルを用意する。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PATTERN_SIZE = 750;
const EYES_COUNT = 40;
// 固定シード。これを基に決定論的に目玉の配置を生成するため、出力は常に同一。
const SEED = 0x9e3779b9;

const themes = {
  retro: { colors: ["#ece5d3", "#90332f", "#8b7a95", "#1f1b1c"], bg: "#1f1b1c" },
  dark: { colors: ["#007ba7", "#003388", "#001533", "#02050a"], bg: "#02050a" },
};

// 座標は小数 2 桁に丸める。フル精度はバイト数を増やすだけで、750px タイル上では
// 表示の差が出ない。
const r2 = (v) => Number(v.toFixed(2));

// 決定論的な擬似乱数生成器（mulberry32）。固定シードから常に同じ数列を返す。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 目玉の配置（設計図）を生成する。テーマには依存しない幾何データのみ。
function generateBaseEyes(rng) {
  const baseEyes = [];
  const colorUsage = [0, 0, 0, 0];

  function getBalancedColorIndex(usedIndices, currentSize) {
    const availableIndices = [0, 1, 2, 3].filter((i) => !usedIndices.includes(i));
    let minUsage = Infinity;
    availableIndices.forEach((i) => {
      if (colorUsage[i] < minUsage) minUsage = colorUsage[i];
    });
    const candidateIndices = availableIndices.filter((i) => colorUsage[i] === minUsage);
    const selectedIndex = candidateIndices[Math.floor(rng() * candidateIndices.length)];
    colorUsage[selectedIndex] += currentSize * currentSize;
    return selectedIndex;
  }

  for (let i = 0; i < EYES_COUNT; i++) {
    const size = rng() * 50 + 200;
    let x = 0,
      y = 0;
    let positionFound = false;
    let attempts = 0;

    while (!positionFound && attempts < 1000) {
      x = rng() * PATTERN_SIZE;
      y = rng() * PATTERN_SIZE;
      positionFound = true;

      for (const existingEye of baseEyes) {
        let dx = Math.abs(x - existingEye.x);
        let dy = Math.abs(y - existingEye.y);
        if (dx > PATTERN_SIZE / 2) dx = PATTERN_SIZE - dx;
        if (dy > PATTERN_SIZE / 2) dy = PATTERN_SIZE - dy;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < (size / 2 + existingEye.size / 2) * 0.5) {
          positionFound = false;
          break;
        }
      }
      attempts++;
    }

    const layersCount = Math.floor(rng() * 1) + 3;
    let currentSize = size;
    let totalOffsetX = 0;
    let totalOffsetY = 0;
    const baseLayers = [];
    const angle = rng() * Math.PI * 2;
    const usedIndices = [];

    for (let j = 0; j < layersCount; j++) {
      if (j > 0) {
        const prevSize = currentSize;
        currentSize = prevSize * (rng() * 0.05 + 0.65);
        const dist = 0.8 * ((prevSize - currentSize) / 2);
        totalOffsetX += Math.cos(angle) * dist;
        totalOffsetY += Math.sin(angle) * dist;
      }
      const colorIndex = getBalancedColorIndex(usedIndices, currentSize);
      usedIndices.push(colorIndex);
      baseLayers.push({ size: currentSize, offsetX: totalOffsetX, offsetY: totalOffsetY, colorIndex });
    }
    baseEyes.push({ x, y, size, baseLayers });
  }
  return baseEyes;
}

// 目玉の配置データから、指定テーマの配色で背景タイル SVG（生の文字列）を組み立てる。
function buildBackgroundSvg(baseEyes, colors, bg) {
  let patternContent = "";

  function addEye(baseX, baseY, layers) {
    let eyeSVG = `<g transform="translate(${r2(baseX)} ${r2(baseY)})">`;
    layers.forEach((layer) => {
      const color = colors[layer.colorIndex];
      eyeSVG += `<circle cx="${r2(layer.offsetX)}" cy="${r2(layer.offsetY)}" r="${r2(layer.size / 2)}" fill="${color}"/>`;
    });
    eyeSVG += `</g>`;
    patternContent += eyeSVG;
  }

  baseEyes.forEach((eye) => {
    const { x, y, size, baseLayers } = eye;
    const r = size / 2;

    addEye(x, y, baseLayers);

    // はみ出しコピー処理（タイルの継ぎ目で目玉が途切れないよう周囲に複製する）
    const crossLeft = x - r < 0;
    const crossRight = x + r > PATTERN_SIZE;
    const crossTop = y - r < 0;
    const crossBottom = y + r > PATTERN_SIZE;

    if (crossLeft) addEye(x + PATTERN_SIZE, y, baseLayers);
    if (crossRight) addEye(x - PATTERN_SIZE, y, baseLayers);
    if (crossTop) addEye(x, y + PATTERN_SIZE, baseLayers);
    if (crossBottom) addEye(x, y - PATTERN_SIZE, baseLayers);
    if (crossLeft && crossTop) addEye(x + PATTERN_SIZE, y + PATTERN_SIZE, baseLayers);
    if (crossLeft && crossBottom) addEye(x + PATTERN_SIZE, y - PATTERN_SIZE, baseLayers);
    if (crossRight && crossTop) addEye(x - PATTERN_SIZE, y + PATTERN_SIZE, baseLayers);
    if (crossRight && crossBottom) addEye(x - PATTERN_SIZE, y - PATTERN_SIZE, baseLayers);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PATTERN_SIZE}" height="${PATTERN_SIZE}"><rect width="${PATTERN_SIZE}" height="${PATTERN_SIZE}" fill="${bg}"/>${patternContent}</svg>`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public");
mkdirSync(outDir, { recursive: true });

// 配置（幾何）は 1 度だけ生成し、両テーマで使い回す。
const baseEyes = generateBaseEyes(mulberry32(SEED));
for (const [name, { colors, bg }] of Object.entries(themes)) {
  const svg = buildBackgroundSvg(baseEyes, colors, bg);
  const file = join(outDir, `bg-${name}.svg`);
  writeFileSync(file, svg);
  console.log(`[generate-bg] wrote ${file} (${svg.length} bytes)`);
}
