import { readFileSync, readdirSync } from "fs";
import path from "path";
import matter from "gray-matter";

const postPath = path.join(process.cwd(), "post");

// 記事のフロントマター（post/*.md 冒頭の YAML）。title と publish は必須、
// lastUpdate は任意。それ以外のキーが将来増えても許容する。
export type PostFrontmatter = {
  title: string;
  publish: string;
  lastUpdate?: string;
  [key: string]: unknown;
};

export function getAllSlugs() {
  return readdirSync(postPath)
    .filter((file) => /\.md$/.test(file))
    .map((file) => file.replace(/\.md$/, ""));
}

export function getPostBySlug(slug: string) {
  const markdown = readFileSync(path.join(postPath, `${slug}.md`), "utf8");

  const { content, data } = matter(markdown);
  return {
    content,
    data: data as PostFrontmatter,
  };
}

export function getAllPosts() {
  const slugs = getAllSlugs();
  const posts = slugs.map((slug) => ({ slug, ...getPostBySlug(slug) }));

  // 公開日の降順（新しい記事が先頭）
  return posts.sort(
    (a, b) =>
      new Date(b.data.publish).getTime() - new Date(a.data.publish).getTime(),
  );
}
