// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://elle-et-noire.github.io',
  base: '/bestand',
  vite: {
    plugins: [tailwindcss()],
    // 数式はビルド時に mathjax の node 版で CHTML へ組版する（lib/mathjax.ts）。
    // これらのパッケージは動的にフォントコンポーネントを require するため、
    // バンドルせず実行時に node_modules から解決させる（Next の serverExternalPackages 相当）。
    ssr: {
      external: [
        'mathjax',
        '@mathjax/src',
        '@mathjax/mathjax-newcm-font',
        '@mathjax/mathjax-tex-font',
      ],
    },
  },
});
