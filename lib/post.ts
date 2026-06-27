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

export function GetAllSlugs() {
  return readdirSync(postPath)
    .filter((path) => /\.md?$/.test(path))
    .map((path) => path.replace(/\.md?$/, ""));
}

export function GetPostBySlug(slug: string) {
  const markdown = readFileSync(path.join(postPath, `${slug}.md`), "utf8");

  const { content, data } = matter(markdown);
  return {
    content,
    data: data as PostFrontmatter,
  };
}

export function GetAllPosts() {
  const slugs = GetAllSlugs();
  const posts = slugs.map((slug) => ({ slug, ...GetPostBySlug(slug) }));

  // sort by date
  return posts.sort((a, b) =>
    (new Date(b.data.publish)).getTime()
    - (new Date(a.data.publish).getTime())
  );
}