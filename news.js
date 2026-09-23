// =========================================
// レアものウォッチ 新着記事の表示
// GitHub Actions（情報を探す係）が集めた記事を読み込んで、
// 「新着」タブに表示します。
// =========================================

// 集めた記事が入っているファイルの場所
const NEWS_URL = "https://raw.githubusercontent.com/mini11-32/rare-watch/main/news.json";

// localStorage の引き出しの名前
const NEWS_DONE_KEY = "rare-watch-news-done"; // 「追加」または「非表示」にした記事
const NEWS_SEEN_KEY = "rare-watch-news-seen"; // 一度見た記事（NEWの印を消すため）

// ----- 画面の部品 -----
const newsList = document.getElementById("news-list");
const newsUpdated = document.getElementById("news-updated");
const newsBadge = document.getElementById("news-badge");
const newsFilters = document.getElementById("news-filters");

// 今選んでいる絞り込み（"all" ＝ すべて、それ以外はキーワード名）
const NEWS_FILTER_KEY = "rare-watch-news-filter";
let newsFilter = localStorage.getItem(NEWS_FILTER_KEY) || "all";

// ----- 記事の入れ物 -----
let newsItems = [];          // 読み込んだ記事
let newsUpdatedAt = null;    // 情報を探す係が最後に動いた時刻
let newsFailed = false;      // 読み込みに失敗したか
const newsDone = new Set(loadIds(NEWS_DONE_KEY));
const newsSeen = new Set(loadIds(NEWS_SEEN_KEY));
// Set ＝ 同じものが重ならない入れ物。「この記事はもう見たか？」をすばやく調べられる

// =========================================
// 記事を読み込む
// =========================================
async function fetchNews() {
  try {
    // 「?t=今の時刻」を付けて、古い内容が使い回されないようにする
    const res = await fetch(`${NEWS_URL}?t=${Date.now()}`);
    const data = await res.json();
    newsItems = data.items || [];
    newsUpdatedAt = data.updatedAt;
    newsFailed = false;
    forgetOldIds();
  } catch {
    newsFailed = true; // 電波が悪いときなど
  }

  updateNewsBadge();
  if (currentTab === "news") renderNews();
}

// =========================================
// 「新着」タブの中身を描く（app.js の render() から呼ばれる）
// =========================================
function renderNews() {
  const remaining = newsItems.filter((n) => !newsDone.has(n.id));

  // 絞り込みボタンを描く
  renderNewsFilters(remaining);

  // 選んでいるキーワードの記事だけにする
  const shown = newsFilter === "all"
    ? remaining
    : remaining.filter((n) => n.keyword === newsFilter);

  // 最終更新の時刻
  newsUpdated.textContent = newsUpdatedAt
    ? `最終更新：${formatDateTime(newsUpdatedAt)}（3時間ごとに自動で更新）`
    : "";

  if (newsFailed) {
    newsList.innerHTML = `<p class="empty">記事を読み込めませんでした。<br>電波の良いところで開き直してください。</p>`;
    return;
  }
  if (shown.length === 0) {
    newsList.innerHTML = `<p class="empty">新しい記事はありません。</p>`;
    return;
  }

  newsList.innerHTML = shown.map(newsCardHtml).join("");

  // 表示した記事は「見た」ことにして、NEWの印と赤い数字を消す
  for (const n of shown) newsSeen.add(n.id);
  saveIds(NEWS_SEEN_KEY, newsSeen);
  updateNewsBadge();
}

// ----- 絞り込みボタン（件数付き） -----
function renderNewsFilters(remaining) {
  // 記事に出てくるキーワードを、重ならないように集める
  const labels = [...new Set(remaining.map((n) => n.keyword))];

  // 選んでいたキーワードの記事がなくなっていたら「すべて」に戻す
  if (newsFilter !== "all" && !labels.includes(newsFilter)) newsFilter = "all";

  const chip = (value, text, count) => `
    <button class="chip ${value === newsFilter ? "is-active" : ""}" data-filter="${escapeHtml(value)}">
      ${escapeHtml(text)} <span class="chip-count">${count}</span>
    </button>`;

  newsFilters.innerHTML =
    chip("all", "すべて", remaining.length) +
    labels.map((l) => chip(l, l, remaining.filter((n) => n.keyword === l).length)).join("");
}

newsFilters.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  newsFilter = chip.dataset.filter;
  localStorage.setItem(NEWS_FILTER_KEY, newsFilter); // 次に開いたときも同じ絞り込みにする
  renderNews();
});

// ----- 記事1つ分のカード -----
function newsCardHtml(n) {
  const isNew = !newsSeen.has(n.id);
  return `
    <li class="card news-card" data-id="${escapeHtml(n.id)}">
      <div class="card-top">
        <span class="badge badge-keyword">${escapeHtml(n.keyword)}</span>
        <span class="news-date">
          ${isNew ? `<span class="new-label">NEW</span>` : ""}
          ${formatDate(n.date)}
        </span>
      </div>
      <h2 class="news-title">${escapeHtml(n.title)}</h2>
      <p class="card-shop">${escapeHtml(n.source)}</p>
      <div class="news-buttons">
        <button class="btn-hide">非表示</button>
        ${isSafeUrl(n.link)
          ? `<a class="btn-sub" href="${escapeHtml(n.link)}" target="_blank" rel="noopener">記事を見る</a>`
          : ""}
        <button class="btn-pick">＋ 気になる</button>
      </div>
    </li>
  `;
}

// ----- 赤い数字（まだ見ていない記事の数）を更新する -----
function updateNewsBadge() {
  const count = newsItems.filter((n) => !newsDone.has(n.id) && !newsSeen.has(n.id)).length;
  newsBadge.hidden = count === 0;
  newsBadge.textContent = count > 99 ? "99+" : count;
}

// =========================================
// ボタンを押したとき
// =========================================
newsList.addEventListener("click", (event) => {
  const card = event.target.closest(".news-card");
  if (!card) return;
  const n = newsItems.find((x) => x.id === card.dataset.id);

  // 「非表示」：この記事をもう出さない
  if (event.target.closest(".btn-hide")) {
    newsDone.add(n.id);
    saveIds(NEWS_DONE_KEY, newsDone);
    renderNews();
  }

  // 「＋ 気になる」：商品として登録して、締め切りを入れられるよう編集画面を開く
  if (event.target.closest(".btn-pick")) {
    const item = {
      id: newId(),
      status: "気になる",
      name: n.title,
      type: guessType(n.title),
      shop: "",
      deadline: "",
      resultDate: "",
      url: n.link,
      genre: n.keyword,
      memo: `ニュース（${n.source}）から追加`,
    };
    items.push(item);
    saveItems();

    newsDone.add(n.id);
    saveIds(NEWS_DONE_KEY, newsDone);
    renderNews();

    openEditSheet(item, "追加しました（締め切りを入れましょう）");
  }
});

// 記事のタイトルから、種類（抽選・再販など）を推測する
function guessType(title) {
  if (title.includes("抽選")) return "抽選";
  if (title.includes("再販")) return "再販";
  if (title.includes("先着")) return "先着";
  if (title.includes("予約")) return "予約";
  return "抽選";
}

// =========================================
// 記録の保存と読み込み
// =========================================
function loadIds(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function saveIds(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

// 記事の一覧から消えた古い記事の記録は、もう要らないので捨てる
function forgetOldIds() {
  const current = new Set(newsItems.map((n) => n.id));
  for (const set of [newsDone, newsSeen]) {
    for (const id of set) {
      if (!current.has(id)) set.delete(id);
    }
  }
  saveIds(NEWS_DONE_KEY, newsDone);
  saveIds(NEWS_SEEN_KEY, newsSeen);
}

// ----- アプリを開いたとき、ほかのアプリから戻ってきたときに読み込む -----
fetchNews();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") fetchNews();
});
