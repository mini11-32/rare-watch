// =========================================
// レアものウォッチ 情報を探す係
// GitHub Actions が数時間ごとにこのプログラムを動かします。
// keywords.json のキーワードで、GoogleニュースとBingニュースを検索して、
// 見つかった記事を news.json に保存します。
// =========================================

import { readFile, writeFile } from "node:fs/promises";

const KEEP_DAYS = 30;        // 何日前までの記事を残しておくか
const MAX_ITEMS = 150;       // 最大で何件まで残しておくか
const MAX_PAGE_VISITS = 80;  // 写真を探す記事の数の上限（1回の実行あたり）
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

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

// ----- キーワードごとに、GoogleとBingでニュースを検索する -----
const found = [];
for (const keyword of keywords) {
  for (const source of [searchGoogle, searchBing]) {
    try {
      const items = await source(keyword);
      console.log(`${keyword.label} (${source.name}): ${items.length}件`);
      found.push(...items);
    } catch (error) {
      // 1つの検索で失敗しても、ほかの検索は続ける
      console.log(`${keyword.label} (${source.name}): 失敗しました (${error.message})`);
    }
  }
}

// ----- 古すぎる記事と関係ない記事を捨てる -----
// （前回までの記事にも同じふるいをかけるので、ふるいを変えると古い記事も入れ替わる）
const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
const candidates = [...found, ...oldItems]
  .filter((item) => new Date(item.date).getTime() > limit)
  .filter((item) => isWanted(item, config));

// ----- 重複を取り除く（同じ記事・似たタイトルは1つだけ残す） -----
// 写真やあらすじが付いている記事を優先して残すため、先に並べておく
candidates.sort((a, b) => score(b) - score(a));
const seenIds = new Set();
const seenTitles = new Set();
const items = [];
for (const item of candidates) {
  const key = titleKey(item.title);
  if (seenIds.has(item.id) || seenTitles.has(key)) continue;
  seenIds.add(item.id);
  seenTitles.add(key);
  items.push(item);
}

// ----- 新しい順に並べて、多すぎる分は捨てる -----
items.sort((a, b) => new Date(b.date) - new Date(a.date));
items.splice(MAX_ITEMS);

// ----- 写真がまだない記事は、写真を探しに行く -----
let visits = 0;
for (const item of items) {
  if (item.image || item.imageTried) continue;
  if (visits >= MAX_PAGE_VISITS) break;
  visits++;

  if (isRealArticle(item.link)) {
    // 元の記事のURLがわかる → そのページの写真を使う
    item.image = await findPageImage(item.link);
  } else if (!item.thumb) {
    // Googleの記事（元のURLがわからない）→ 同じタイトルでBingを検索して、よく似た記事の写真を借りる
    const twin = await findTwinOnBing(item);
    if (twin) {
      item.thumb = twin.thumb;
      item.image = await findPageImage(twin.link);
    }
    await wait(500); // Bingに続けて何度も頼みすぎないよう、少し間をあける
  }
  item.imageTried = true; // 見つからなくても、次からは探しに行かない
}
console.log(`写真を ${visits}件探しました`);

await writeFile("news.json", JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`合計 ${items.length}件を保存しました（写真あり ${items.filter((i) => i.image || i.thumb).length}件）`);

// =========================================
// Googleニュースで検索する（記事が多いが、写真と元のURLはない）
// =========================================
async function searchGoogle(keyword) {
  // 直近7日間のニュースに絞って検索する
  const query = encodeURIComponent(`${keyword.query} when:7d`);
  const res = await fetch(`https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`);
  const xml = await res.text();

  return eachItem(xml).map((body) => {
    const source = pick(body, "source");
    let title = pick(body, "title");
    // タイトルの最後に付いている「 - サイト名」を取る
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }
    return {
      id: pick(body, "guid"),
      keyword: keyword.label,
      title,
      source,
      link: pick(body, "link"),
      date: toIso(pick(body, "pubDate")),
    };
  }).filter((item) => item.id && item.title && item.date);
}

// =========================================
// Bingニュースで検索する（記事は少なめだが、写真・あらすじ・元のURLがある）
// =========================================
async function searchBing(keyword) {
  return fetchBing(keyword.query, keyword.label);
}

// Bingニュースに言葉を送って、記事の一覧を受け取る
async function fetchBing(words, label) {
  const query = encodeURIComponent(words);
  const res = await fetch(
    `https://www.bing.com/news/search?q=${query}&format=rss&setlang=ja&cc=JP&count=50`,
    { headers: { "User-Agent": BROWSER }, signal: AbortSignal.timeout(8000) },
  );
  const xml = await res.text();

  return eachItem(xml).map((body) => {
    // Bingのリンクには、元の記事のURLが「url=」のところに入っている
    const bingLink = pick(body, "link");
    const realUrl = decodeURIComponent((bingLink.match(/[?&]url=([^&]+)/) || [])[1] || "");
    const thumb = pick(body, "News:Image");
    return {
      id: `bing:${realUrl}`,
      keyword: label,
      // Bingのタイトルは長いと「...」で切れるので、その「...」を取る
      title: pick(body, "title").replace(/\s*(\.\.\.|…)$/, ""),
      summary: pick(body, "description").slice(0, 140),
      source: pick(body, "News:Source"),
      link: realUrl,
      // Bingの小さな写真。大きめのサイズで取れるように指定する
      thumb: thumb ? `${thumb.replace(/^http:/, "https:")}&w=480&h=270&c=7` : "",
      date: toIso(pick(body, "pubDate")),
    };
  }).filter((item) => item.link && item.title && item.date);
}

// =========================================
// Googleの記事とよく似たタイトルの記事を、Bingで探す
// =========================================
async function findTwinOnBing(item) {
  try {
    const results = await fetchBing(item.title.slice(0, 60), item.keyword);
    let best = null;
    let bestScore = 0;
    for (const r of results) {
      const s = similarity(item.title, r.title);
      if (s > bestScore) {
        best = r;
        bestScore = s;
      }
    }
    // 似ている度合いが0.5以上（半分以上同じ）なら、同じ話題の記事とみなす
    return bestScore >= 0.5 ? best : null;
  } catch {
    return null;
  }
}

// 2つのタイトルがどれくらい似ているか（0〜1。1ならまったく同じ）
// 2文字ずつの組（例：「一番」「番く」「くじ」）が、どれだけ共通しているかで比べる
function similarity(a, b) {
  const pairs = (text) => {
    const t = titleKey(text, Infinity);
    const list = [];
    for (let i = 0; i < t.length - 1; i++) list.push(t.slice(i, i + 2));
    return list;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  // Bingのタイトルは途中で切れていることがあるので、短いほうの長さで比べる
  const shorter = Math.min(pa.length, pb.length);
  if (shorter < 5) return 0;
  const bag = new Set(pb);
  const common = pa.filter((p) => bag.has(p)).length;
  return Math.min(1, common / shorter);
}

// 指定した時間（ミリ秒）だけ待つ
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================================
// 記事のページから、写真（og:image）のURLを探す
// og:image ＝ SNSでリンクを貼ったときに表示される、記事の代表写真
// =========================================
async function findPageImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER },
      signal: AbortSignal.timeout(8000), // 8秒たっても返事がなければあきらめる
    });
    const html = (await res.text()).slice(0, 300000);
    const tag = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*>/i);
    const content = tag && tag[0].match(/content=["']([^"']+)["']/i);
    if (!content) return "";
    const image = new URL(decode(content[1]), url).href; // 「/img/a.jpg」のような書き方も、完全なURLに直す
    return image.startsWith("https://") ? image : "";
  } catch {
    return "";
  }
}

// =========================================
// ふるい：残したい記事なら true、捨てる記事なら false
// =========================================
function isWanted(item, config) {
  const keyword = config.keywords.find((k) => k.label === item.keyword);
  if (!keyword) return false; // キーワード一覧から消えた言葉の記事は捨てる

  const title = item.title;
  // 残す言葉は、タイトルとあらすじの両方から探す（Bingはタイトルが途中で切れることがあるため）
  const text = `${title} ${item.summary || ""}`;
  const inTitle = (words = []) => words.some((w) => title.includes(w));
  const inText = (words = []) => words.some((w) => text.includes(w));

  if (inTitle(config.excludeAll) || inTitle(keyword.exclude)) return false; // 捨てる言葉が入っている
  if (keyword.include && !inText(keyword.include)) return false;           // 残す言葉が1つも入っていない
  // require：まとまりごとに、どれか1つは入っていないといけない（例：「抽選」と「BOX」の両方）
  if (keyword.require && !keyword.require.every((group) => inText(group))) return false;

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

// 重複を見つけるために、タイトルの細かい違いをそろえて、最初の20文字を比べる
// 例：「〇〇 2枚目の写真・画像」「〇〇（インサイド）」「〇〇...」→ 同じ記事とみなす
function titleKey(title, length = 20) {
  return title
    .replace(/\s*\d+枚目の写真・画像$/, "")
    .replace(/\s*[（(][^）)]*[）)]$/, "")
    .replace(/[\s　☆！!「」『』【】“”"]/g, "")
    .slice(0, length);
}

// 重複したときに、どちらを残すかの点数（写真・あらすじ・元のURLがあるほど高い）
function score(item) {
  return (item.image ? 4 : 0) + (item.thumb ? 2 : 0) + (item.summary ? 1 : 0) + (isRealArticle(item.link) ? 1 : 0);
}

// Googleニュースの中継リンクではない、元の記事のURLかどうか
function isRealArticle(url) {
  return /^https?:\/\//.test(url || "") && !url.startsWith("https://news.google.com/");
}

// =========================================
// RSS（ニュースの一覧が入った文書）を読むための道具
// =========================================

// 記事1つ分（<item>〜</item>）ずつに分ける
function eachItem(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}

// <タグ名>中身</タグ名> の「中身」を取り出す
function pick(body, tag) {
  const match = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decode(match[1].trim()) : "";
}

// 日付を決まった形（ISO形式）にそろえる。読めない日付なら空にする
function toIso(text) {
  const date = new Date(text);
  return isNaN(date) ? "" : date.toISOString();
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
