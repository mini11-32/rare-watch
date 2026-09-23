// =========================================
// レアものウォッチ 情報を探す係
// GitHub Actions が数時間ごとにこのプログラムを動かします。
// keywords.json のキーワードでニュースを検索して、
// 見つかった記事を news.json に保存します。
// =========================================

import { readFile, writeFile } from "node:fs/promises";

const KEEP_DAYS = 30;   // 何日前までの記事を残しておくか
const MAX_ITEMS = 150;  // 最大で何件まで残しておくか

// ----- キーワードを読み込む -----
const keywords = JSON.parse(await readFile("keywords.json", "utf8"));

// ----- 前回までに見つけた記事を読み込む（なければ空っぽ） -----
let oldItems = [];
try {
  oldItems = JSON.parse(await readFile("news.json", "utf8")).items;
} catch {
  // 初めて動かしたときは news.json がないので、そのまま進む
}

// ----- キーワードごとにニュースを検索する -----
const found = [];
for (const keyword of keywords) {
  try {
    // 直近7日間のニュースに絞って検索する
    const query = encodeURIComponent(`${keyword.query} when:7d`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = parseRss(xml, keyword.label);
    console.log(`${keyword.label}: ${items.length}件`);
    found.push(...items);
  } catch (error) {
    // 1つのキーワードで失敗しても、ほかのキーワードは続ける
    console.log(`${keyword.label}: 失敗しました (${error.message})`);
  }
}

// ----- 前回の記事と合わせて、重複を取り除く -----
const byId = new Map();
for (const item of [...found, ...oldItems]) {
  if (!byId.has(item.id)) byId.set(item.id, item);
}

// ----- 古すぎる記事を捨てて、新しい順に並べる -----
const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
const items = [...byId.values()]
  .filter((item) => new Date(item.date).getTime() > limit)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, MAX_ITEMS);

await writeFile("news.json", JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`合計 ${items.length}件を保存しました`);

// =========================================
// RSS（ニュースの一覧が入った文書）から記事を取り出す
// =========================================
function parseRss(xml, label) {
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = pick(body, "source");
    let title = pick(body, "title");
    // タイトルの最後に付いている「 - サイト名」を取る
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }
    items.push({
      id: pick(body, "guid"),
      keyword: label,
      title,
      source,
      link: pick(body, "link"),
      date: new Date(pick(body, "pubDate")).toISOString(),
    });
  }
  return items.filter((item) => item.id && item.title);
}

// <タグ名>中身</タグ名> の「中身」を取り出す
function pick(body, tag) {
  const match = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decode(match[1].trim()) : "";
}

// &amp; などの記号を元の文字に戻す
function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
