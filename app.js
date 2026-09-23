// =========================================
// レアものウォッチ 動きの設定
// =========================================

// ----- 画面の部品を探して、名前を付けておく -----
const addButton = document.getElementById("btn-add");         // 右下の＋ボタン
const addSheet = document.getElementById("add-sheet");        // 登録画面
const cancelButton = document.getElementById("btn-cancel");   // キャンセルボタン
const addForm = document.getElementById("add-form");          // 入力欄のまとまり
const itemList = document.getElementById("item-list");        // 商品の一覧
const emptyMessage = document.getElementById("empty-message"); // 登録がないときのメッセージ
const sheetTitle = document.getElementById("sheet-title");    // 登録画面の見出し
const deleteButton = document.getElementById("btn-delete");   // 削除ボタン

const tabs = document.getElementById("tabs");                 // 絞り込みタブ

// 今編集している商品の背番号（新しく登録するときは null ＝「なし」）
let editingId = null;

// 今選ばれているタブ（最初は「すべて」）
let currentTab = "all";

// ----- 登録した商品をしまっておく入れ物（配列） -----
// 配列 ＝ 複数のデータを順番に並べて入れておける箱
// 起動したときに、前回保存したデータを読み込んでおく
const STORAGE_KEY = "rare-watch-items"; // 収納棚の中の「引き出しの名前」
const items = loadItems();

// 登録画面にある入力欄の名前の一覧
const FIELDS = ["name", "type", "shop", "deadline", "resultDate", "url", "genre", "memo"];

// ----- ＋ボタンを押したら、空っぽの登録画面を開く -----
addButton.addEventListener("click", () => {
  editingId = null;
  addForm.reset();
  sheetTitle.textContent = "商品を登録";
  deleteButton.hidden = true;
  addSheet.showModal();
});

// ----- カードをタップしたら、その商品の編集画面を開く -----
itemList.addEventListener("click", (event) => {
  // 状態の欄や「応募ページへ」ボタンを押したときは、編集画面を開かない
  if (event.target.closest(".status, .btn-go")) return;

  const card = event.target.closest(".card");
  if (!card) return;

  const item = items.find((i) => i.id === card.dataset.id);
  editingId = item.id;

  // 入力欄に、今の内容を入れておく
  addForm.reset();
  for (const name of FIELDS) {
    addForm.elements[name].value = item[name] || "";
  }

  sheetTitle.textContent = "商品を編集";
  deleteButton.hidden = false;
  addSheet.showModal();
});

// ----- 削除ボタンを押したら、確認してから消す -----
deleteButton.addEventListener("click", () => {
  if (!confirm("この商品を削除しますか？")) return;

  const index = items.findIndex((i) => i.id === editingId);
  items.splice(index, 1); // 入れ物から1つ取り除く
  saveItems();
  render();

  addForm.reset();
  addSheet.close();
});

// ----- キャンセルを押したら、入力を消して閉じる -----
cancelButton.addEventListener("click", () => {
  addForm.reset();
  addSheet.close();
});

// ----- 保存を押したら、商品を追加（または更新）して一覧を描き直す -----
addForm.addEventListener("submit", (event) => {
  event.preventDefault(); // ページが再読み込みされるのを止める

  // 入力欄の内容を取り出す
  const data = new FormData(addForm);

  if (editingId) {
    // 編集のとき：今ある商品の中身を書き換える
    const item = items.find((i) => i.id === editingId);
    for (const name of FIELDS) {
      item[name] = data.get(name);
    }
  } else {
    // 新しく登録するとき：新しい商品を作って追加する
    const item = {
      id: newId(),        // 商品ごとの背番号（どのカードかを見分けるため）
      status: "気になる", // 最初はみんな「気になる」
    };
    for (const name of FIELDS) {
      item[name] = data.get(name);
    }
    items.push(item); // 入れ物に追加
  }

  saveItems();      // ブラウザの中に保存
  render();         // 一覧を描き直す

  addForm.reset();
  addSheet.close();
});

// ----- タブを押したら、そのタブに切り替えて描き直す -----
tabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;

  currentTab = tab.dataset.tab;

  // 押したタブだけを紫色にする
  for (const t of tabs.querySelectorAll(".tab")) {
    t.classList.toggle("is-active", t === tab);
  }

  render();
});

// ----- カードの状態を選び直したら、保存して描き直す -----
// 一覧全体を見張っておき、どのカードの状態が変わったかを背番号で見分ける
itemList.addEventListener("change", (event) => {
  if (!event.target.classList.contains("status")) return; // 状態の欄以外は無視

  const id = event.target.closest(".card").dataset.id;
  const item = items.find((i) => i.id === id);
  item.status = event.target.value;

  saveItems();
  render();
});

// =========================================
// データの保存と読み込み（localStorage を使う）
// localStorage ＝ ブラウザの中にある、ページを閉じても消えない収納棚
// =========================================

// 保存する（配列を文字にしてしまう）
function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// 読み込む（しまってある文字を配列に戻す）
function loadItems() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const list = saved ? JSON.parse(saved) : []; // 何もなければ空の配列
    // 背番号がない古いデータには、ここで背番号を付ける
    list.forEach((item) => {
      if (!item.id) item.id = newId();
    });
    return list;
  } catch {
    return []; // 読み込みに失敗したら空の配列から始める
  }
}

// =========================================
// 一覧を画面に描く
// =========================================
function render() {
  // 今のタブに合う商品だけを取り出す
  const shown = items.filter(matchesTab);

  // 表示する商品が0件ならメッセージを出す
  emptyMessage.hidden = shown.length > 0;
  emptyMessage.innerHTML = items.length === 0
    ? "まだ登録がありません。<br>右下の「＋」から追加しましょう。"
    : "このタブに表示する商品はありません。";

  // 締め切りが近い順に並べ替えてから、一覧を作り直す
  const sorted = shown.sort(compareItems);
  itemList.innerHTML = sorted.map(cardHtml).join("");
}

// その商品が、今のタブに表示するものかどうか
function matchesTab(item) {
  if (currentTab === "watch") return item.status === "気になる";
  if (currentTab === "applied") return item.status === "応募済み";
  if (currentTab === "result") return ["当選", "落選", "購入済み"].includes(item.status);
  return true; // すべて
}

// 2つの商品を比べて、どちらを上にするか決める
// （答えがマイナスなら a が上、プラスなら b が上）
function compareItems(a, b) {
  const groupA = sortGroup(a);
  const groupB = sortGroup(b);
  if (groupA !== groupB) return groupA - groupB;       // グループが違えば、グループ順
  if (groupA === 1) return 0;                          // 締め切りなし同士は、そのまま
  return new Date(a.deadline) - new Date(b.deadline);  // 同じグループなら、締め切りが早いほうが上
}

// グループ分け：0 ＝ これから締め切り、1 ＝ 締め切りなし、2 ＝ 締め切りが過ぎた
function sortGroup(item) {
  if (!item.deadline) return 1;
  if (new Date(item.deadline) < new Date()) return 2;
  return 0;
}

// ----- 商品1つ分のカードのHTMLを作る -----
function cardHtml(item) {
  const isPast = sortGroup(item) === 2;                    // 締め切りの時刻が過ぎたか
  const left = isPast ? -1 : daysLeft(item.deadline);      // 過ぎていたら「終了」扱い
  const isUrgent = left !== null && left >= 0 && left <= 3; // 残り3日以内

  // 締め切りと発表日の欄（入力されているものだけ表示）
  let dates = "";
  if (item.deadline) {
    dates += `<div><dt>締め切り</dt><dd>${formatDateTime(item.deadline)}</dd></div>`;
  }
  if (item.resultDate) {
    dates += `<div><dt>発表</dt><dd>${formatDate(item.resultDate)}</dd></div>`;
  }

  // URLが入っているときだけ「応募ページへ」ボタンを出す
  const goButton = isSafeUrl(item.url)
    ? `<a class="btn-go" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">応募ページへ</a>`
    : "";

  return `
    <li class="card ${isUrgent ? "is-urgent" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="card-top">
        <span class="badge ${badgeClass(item.type)}">${escapeHtml(item.type)}</span>
        ${deadlineLabel(left)}
      </div>
      <h2 class="card-title">${escapeHtml(item.name)}</h2>
      ${item.shop ? `<p class="card-shop">${escapeHtml(item.shop)}</p>` : ""}
      ${dates ? `<dl class="card-dates">${dates}</dl>` : ""}
      <div class="card-bottom">
        ${statusSelect(item.status)}
        ${goButton}
      </div>
    </li>
  `;
}

// ----- 状態を選ぶ欄（タップすると選択肢が出る）を作る -----
const STATUSES = ["気になる", "応募済み", "当選", "落選", "購入済み"];

function statusSelect(current) {
  const options = STATUSES.map((s) =>
    `<option ${s === current ? "selected" : ""}>${s}</option>`
  ).join("");
  return `<select class="status ${statusClass(current)}">${options}</select>`;
}

// 状態ごとの色
function statusClass(status) {
  if (status === "応募済み") return "status-applied";
  if (status === "当選") return "status-won";
  if (status === "落選") return "status-lost";
  if (status === "購入済み") return "status-bought";
  return "status-watch"; // 気になる
}

// =========================================
// 小さな便利道具（関数）
// 関数 ＝ よく使う処理に名前を付けて、何度でも呼び出せるようにしたもの
// =========================================

// 重なりにくい背番号を作る（今の時刻 ＋ ランダムな文字）
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 締め切りまであと何日かを計算する（締め切りが空なら null ＝「なし」）
function daysLeft(deadline) {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(deadline);
  day.setHours(0, 0, 0, 0);
  return Math.round((day - today) / (1000 * 60 * 60 * 24));
}

// 残り日数の表示（「あと2日」「今日まで」「終了」）
function deadlineLabel(left) {
  if (left === null) return "";
  if (left < 0) return `<span class="deadline is-done">終了</span>`;
  if (left === 0) return `<span class="deadline">今日まで</span>`;
  return `<span class="deadline">あと${left}日</span>`;
}

// 種類ごとのラベルの色
function badgeClass(type) {
  if (type === "抽選") return "badge-lottery";
  if (type === "再販") return "badge-restock";
  if (type === "先着") return "badge-first";
  return "badge-reserve"; // 予約
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// 「9/25（木）」の形にする
function formatDate(value) {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
}

// 「9/25（木）23:59」の形にする
function formatDateTime(value) {
  const d = new Date(value);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(value)} ${hh}:${mm}`;
}

// http:// か https:// で始まるURLだけを使う（変なリンクを防ぐため）
function isSafeUrl(url) {
  return /^https?:\/\//.test(url || "");
}

// 入力された文字をそのまま表示しても安全なように変換する
// （「<」などの記号がHTMLとして動いてしまうのを防ぐ）
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ----- 最初に一度、一覧を描く -----
render();
