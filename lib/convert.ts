import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

import { renderArticleMath } from "./mathjax";
import { codeTheme } from "./codeTheme";

// 本文リンクの安全化。Next 版の component/safelink.tsx と同じ方針：
// 外部リンク（/ や # で始まらない）は新規タブで開き rel を付ける。空 href は / に向ける。
function rehypeSafeLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a") return;
      let href = node.properties?.href;
      if (typeof href !== "string") return;
      if (href === "") {
        href = "/";
        node.properties.href = "/";
      }
      if (!href.startsWith("/") && !href.startsWith("#")) {
        node.properties.target = "_blank";
        node.properties.rel = "noopener noreferrer";
      }
    });
  };
}

export type Converted = {
  // 本文の HTML 文字列（数式は CHTML として埋め込み済み）。
  html: string;
  // この記事で実際に使われたグリフぶんの CHTML スタイルシート。
  css: string;
};

export const markdownToHtml = async (text: string): Promise<Converted> => {
  const spacer = "\\hspace{0.2em}";
  const rsmashers = ["。", "、", "）", "，", "．", " ", "　", "-", "：", "", "(", "（"];
  const lsmashers = ["（", "-", "", ")", "）"];
  // 記事内の数式（区切り記号付きの TeX）を出現順に集める。ビルド時に CHTML へ
  // 一括組版し、各プレースホルダ（data-im / data-dm の span）へ結果 HTML を流し込む。
  const mathexprs: string[] = [];
  let ord = 0;

  const evacuees: { [label: string]: string } = {};
  // offset は $ 基準
  const opener = (string: string, offset: number) => rsmashers.includes(string.substring(offset - 1, offset)) ? "\\(" : "\\(" + spacer;
  const closer = (string: string, offset: number) => lsmashers.includes(string.substring(offset + 1, offset + 2)) ? "\\)" : spacer + "\\)";

  // $ で挟まれた文中数式
  let opnum = 0, clnum = 0;
  let nextop = true; // 次にくる $ の開 or 閉
  // 脚注
  let footnotes = "\n";
  let footnum = 0;

  let rear = -1;  // dispmath の直下では rear = -1
  // /(?<=\\\\|[^\\\$]|^)\$(?!\$)/g と組み合わせる replacer。数式チャンク中で $ のスペーシングを行う
  const dollarspacer = (_: string, offset: number, string: string) => {
    if (rear == -1) {
      rear = offset;
      nextop = true;
      return opener(string, offset);
    }
    if (opnum == clnum && nextop) {
      rear = -1;
      return closer(string, offset);
    }
    const between = string.substring(rear, offset);
    const op = (between.match(/(?<!\\)\{/g) || []).length;
    const cl = (between.match(/(?<!\\)\}/g) || []).length;
    if (op == cl) nextop = !nextop;
    else nextop = op > cl;
    opnum += op;
    clnum += cl;
    rear = offset;
    return (nextop ? opener(string, offset) : closer(string, offset));
  }

  const processible = text.replace(/````[\s\S]*?````|```[\s\S]*?```|``[\s\S]*?``|`[\s\S]*?`/g, (match: string) => { // pre > code
    evacuees["quote" + ord] = match;
    return `<quote${ord++}/>`;
  }).replace(/<!--[\s\S]*?-->/g, () => "") // インラインのコメントは取り除く
    .replace(/(!\[[\s\S]*?\]\([\s\S]*?\))\[([\s\S]*?)(?<!\\)\]/g, (_, p1: string, p2: string) => {
      return `${p1}\n\n<p class="img-caption text-center">${p2}</p>`;
    }).replace(/\\\(/g, (_, offset: number, string: string) => opener(string, offset))
    .replace(/\\\)/g, (_, offset: number, string: string) => closer(string, offset + 1))
    .replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\begin\{([^\}]*)\}[\s\S]*?\\end\{\1\}/g, (math: string) => {
      rear = -1;  // dispmath の直下では rear = -1
      // ここでは nextop はマッチした $ の開 or 閉
      evacuees["dispmath" + ord] = math.replace(/(?<=\\\\|[^\\\$]|^)\$(?!\$)/g, dollarspacer);
      opnum = clnum = 0;
      nextop = true;
      return `<dispmath${ord++}/>`;
    }).replace(/\\\([\s\S]*?\\\)/g, (match: string) => { // \( \) のスペーシングは既に行われている
      rear = -1;
      evacuees["inmath" + ord] = match.replace(/(?<=\\\\|[^\\\$]|^)\$(?!\$)/g, dollarspacer);
      return `<inmath${ord++}/>`;
    }).concat(" $").replace(/(?<=\\\\|[^\\]|^)\$([\s\S]*?(?:\\\\|[^\\]))(?=\$)/g, (match: string, p1: string, offset: number, string: string) => {
      if (opnum == clnum) {
        if (!nextop) {
          evacuees[`inmath${ord++}`] += closer(string, offset);
          nextop = true;
          return p1;
        } else
          evacuees[`inmath${ord}`] = "";
      }
      const op = (match.match(/(?<!\\)\{/g) || []).length;
      const cl = (match.match(/(?<!\\)\}/g) || []).length;
      evacuees[`inmath${ord}`] += (nextop ? opener(string, offset) : closer(string, offset)) + p1;
      if (op == cl) nextop = !nextop;
      else nextop = op > cl;
      opnum += op;
      clnum += cl;
      return (opnum > clnum ? "" : `<inmath${ord}/>`);
    }).replace(/\s\$/, "").replace(/\\(eq)?ref\{[^}]*\}/g, (match: string) => {
      evacuees[`inmath${ord}`] = match;
      return `<inmath${ord++}/>`;
    }).replace(/:::details\s(.*)\r?\n([\s\S]*?):::/g, (_, title: string, content: string) => {
      return `<details><summary>${title}</summary>${content.replace(/\r?\n/g, "<br/>")}</details>`;
    }).replace(/:::(def|thm)\s(.*)\r?\n([\s\S]*?):::/g, (_, env: string, title: string, content: string) => {
      return `<div class="box ${env}">
<div class="title-container">
<span class="box-title">${title}</span>
</div>
<div class="box-content">
${content}
</div>
</div>`;
    }).replace(/:::proof\s(.*)\r?\n([\s\S]*?):::/g, (_, title: string, content: string) => {
      return `<details class="proof"><summary>**証明**${title}</summary><div>${content.replace(/\r?\n/g, "<br/>")}</div></details>`;
    }).replace(/<br>/g, "<br/>")
    .replace(/\[([^\]]+)\]\{([^}]+)\}/g, "<span class='has-tooltip relative items-center'><span class='inline-block tooltip balloon'>$2</span>$1</span>")
    .replace(/\^\[([^\]]+)\]/g, (_, p1: string): string => {
      footnotes += `\n[^${++footnum}]: ${p1}\n`;
      return `<span class='has-tooltip relative items-center no-underline'><span class='inline-block tooltip balloon'>${p1}</span>[^${footnum}]</span>`;
    }).concat(footnotes).replace(/(<(?:inmath|dispmath)\d+\/>)(\r?\n|<br\/>)/g, "$1") // 数式と文章の間の改行による隙間を消す
    .replace(/<((?:inmath|dispmath)\d+)\/>/g, (_, mode: string): string => {
      const display = mode.substring(0, 8) == "dispmath";
      const index = mathexprs.length;
      mathexprs.push(evacuees[mode]); // 区切り記号付きの TeX をそのまま渡す
      // 組版済み CHTML をあとから流し込むための空プレースホルダ。
      return display ? `<span data-dm="${index}"></span>` : `<span data-im="${index}"></span>`;
    })
    .replace(/<(quote\d+)\/>/g, (_, mode: string) => evacuees[mode].replace(/(^`{3,})([^`\r\n]+)/g, (__, p1: string, p2: string): string => {
      const titles = p2.split(':');
      return p1 + titles[0].replace(/diff\s/, "diff-") + (titles.length > 1 ? ("[data-file='" + titles[1] + "']") : '');
    }).replace(/^(`{3,})mermaid([^`]+)\1/g, "\n<div class='mermaid'>%%{init:{'theme':'base','themeVariables':{'primaryColor':'#007777','primaryTextColor':'#f0f6fc','primaryBorderColor':'#008888','secondaryColor':'#145055','tertiaryColor': '#fff0f0','edgeLabelBackground':'#002b3600','lineColor':'#007777CC','noteTextColor':'#e2e8f0','noteBkgColor':'#007777BB','textColor':'#f0f6fc','fontSize':'16px'},'themeCSS':'text.actor {font-size:20px !important;}'}}%%$2</div>\n")
    );

  // 収集した数式をビルド時に一括で CHTML へ組版する。
  const { html: mathHtml, css } = await renderArticleMath(mathexprs);

  // remark/rehype パイプライン。Next 版（next-mdx-remote の compileMDX）と同じく
  // remark-gfm → rehype-pretty-code → rehype-slug を通すが、出力は React ではなく
  // HTML 文字列にする。前処理で差し込んだ生 HTML（details/box/span/プレースホルダ）は
  // remark-rehype の allowDangerousHtml + rehype-raw で本物のノードへ変換する。
  // rehype-pretty-code は rehype-raw より前に走らせ、コードフェンスの meta（言語・
  // ファイル名）が失われないようにする。
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePrettyCode, {
      // Zenn を模した単一のダークテーマ。地色は globals.css の .post pre（#1a2638）に
      // 任せ、トークン色だけこのテーマで塗る。
      theme: codeTheme,
      keepBackground: false,
    })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSafeLinks)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processible);

  // 組版済み CHTML をプレースホルダへ流し込む。Imath は素の span、Dmath は
  // 横スクロール可能な span.scrollable で包む（Next 版の Imath/Dmath と同じ）。
  const html = String(file)
    .replace(/<span data-im="(\d+)"><\/span>/g, (_, i: string) => `<span>${mathHtml[Number(i)] ?? ""}</span>`)
    .replace(/<span data-dm="(\d+)"><\/span>/g, (_, i: string) => `<span class="scrollable">${mathHtml[Number(i)] ?? ""}</span>`);

  return { html, css };
};
