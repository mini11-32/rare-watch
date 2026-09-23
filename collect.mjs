// =========================================
// レアものウォッチ 情報を探す係
// GitHub Actions が数時間ごとにこのプログラムを動かします。
// keywords.json のキーワードでニュースを検索して、
// 見つかった記事を news.json に保存します。
// =========================================

import { readFile, writeFile } from "node:fs/promises";

const KEEP_DAYS = 30;   // 何日前までの記事を残しておくか
const MAX_ITEMS = 150;  // 最大で何件まで残しておくか

// ----- キーワードと「ふるい」の設定を読み込む -----
const config = JSON.parse(await readFile("keywords.json", "utf8"));
const keywords = config.keywords;

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

// ----- 古すぎる記事と関係ない記事を捨てて、新しい順に並べる -----
// （前回までの記事にも同じふるいをかけるので、ふるいを変えると古い記事も入れ替わる）
const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
const sorted = [...found, ...oldItems]
  .filter((item) => new Date(item.date).getTime() > limit)
  .filter((item) => isWanted(item, config))
  .sort((a, b) => new Date(b.date) - new Date(a.date));

// ----- 重複を取り除く（同じ記事・同じタイトルは1つだけ残す） -----
const seenIds = new Set();
const seenTitles = new Set();
const items = [];
for (const item of sorted) {
  const key = normalizeTitle(item.title);
  if (seenIds.has(item.id) || seenTitles.has(key)) continue;
  seenIds.add(item.id);
  seenTitles.add(key);
  items.push(item);
}
items.splice(MAX_ITEMS); // 多すぎる分は捨てる

await writeFile("news.json", JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`合計 ${items.length}件を保存しました`);

// =========================================
// ふるい：残したい記事なら true、捨てる記事なら false
// =========================================
function isWanted(item, config) {
  const keyword = config.keywords.find((k) => k.label === item.keyword);
  if (!keyword) return false; // キーワード一覧から消えた言葉の記事は捨てる

  const title = item.title;
  const has = (words = []) => words.some((w) => title.includes(w));

  if (has(config.excludeAll) || has(keyword.exclude)) return false; // 捨てる言葉が入っている
  if (keyword.include && !has(keyword.include)) return false;       // 残す言葉が1つも入っていない
  // require：まとまりごとに、どれか1つは入っていないといけない（例：「抽選」と「BOX」の両方）
  if (keyword.require && !keyword.require.every((group) => has(group))) return false;

  // 去年より前の年（例：2023年）が書かれていたら、昔の商品の記事なので捨てる
  const thisYear = new Date().getFullYear();
  for (const [, year] of title.matchAll(/(20\d\d)年/g)) {
    if (Number(year) < thisYear) return false;
  }

  // 「6月5日更新」「9/22更新」のような日付が1か月以上前なら、昔のまとめ記事なので捨てる
  const updated = title.match(/(\d{1,2})[月/](\d{1,2})日?更新/);
  if (updated && daysSince(Number(updated[1]), Number(updated[2])) > 30) return false;

  return true;
}

// 「〇月〇日」が今日から何日前かを数える（未来の日付になるなら、去年のこととみなす）
function daysSince(month, day) {
  const now = new Date();
  const date = new Date(now.getFullYear(), month - 1, day);
  if (date > now) date.setFullYear(now.getFullYear() - 1);
  return (now - date) / (24 * 60 * 60 * 1000);
}

// 重複を見つけるために、タイトルの細かい違いをそろえる
// 例：「〇〇 2枚目の写真・画像」「〇〇（インサイド）」→「〇〇」
function normalizeTitle(title) {
  return title
    .replace(/\s*\d+枚目の写真・画像$/, "")
    .replace(/\s*[（(][^）)]*[）)]$/, "")
    .replace(/[\s　☆！!]/g, "");
}

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
