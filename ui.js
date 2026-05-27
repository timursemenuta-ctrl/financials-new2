import { convert } from "./api.js";
import { capitalSeries, cryptoValue, dailyFlow, expenseByCategory } from "./analytics.js";
import { cryptoView, exchangeView, homeView, icon, walletsView, analyticsView } from "./components.js";
import { auth, actions, refreshRemote, resetAll, setRoute, state } from "./state.js";
import { isoDate } from "./format.js";

const charts = new Map();

export function bootUi() {
  document.documentElement.dataset.theme = state.settings.theme || "dark";
  document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date());
  setupAuth();
  bindGlobalEvents();
  render();
  setInterval(refreshRemote, 1000 * 60 * 12);
}

export function render() {
  document.querySelector("#views").innerHTML = routeMarkup();
  document.querySelectorAll("#bottomNav button").forEach((button) => button.classList.toggle("is-active", button.dataset.route === state.route));
  refreshIcons();
  queueMicrotask(() => {
    renderCharts();
    renderSparklines();
    enableDragSort();
  });
}

export function toast(message, tone = "info") {
  const zone = document.querySelector("#toastZone");
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.textContent = message;
  zone.append(item);
  setTimeout(() => item.remove(), 3200);
}

function routeMarkup() {
  const map = {
    home: homeView,
    wallets: walletsView,
    exchange: exchangeView,
    analytics: analyticsView,
    crypto: cryptoView
  };
  return `<section class="view is-entering">${map[state.route](state)}</section>`;
}

function setupAuth() {
  const onboarding = document.querySelector("#onboarding");
  const lock = document.querySelector("#lockScreen");
  if (!auth.isOnboarded()) {
    lock.classList.remove("is-visible");
    onboarding.classList.add("is-visible");
  } else {
    onboarding.classList.remove("is-visible");
    lock.classList.add("is-visible");
  }

  document.querySelector("#startAppBtn").addEventListener("click", () => {
    const pin = document.querySelector("#pinSetup").value.trim();
    if (pin.length < 4) return toast("PIN должен быть минимум 4 цифры", "warn");
    auth.setPin(pin);
    onboarding.classList.remove("is-visible");
    lock.classList.remove("is-visible");
    toast("Добро пожаловать в FinPulse");
  });

  let typed = "";
  const dots = document.querySelector("#pinDots");
  const pad = document.querySelector("#pinPad");
  const redrawPin = () => {
    dots.innerHTML = Array.from({ length: 4 }, (_, i) => `<span class="${typed[i] ? "is-filled" : ""}"></span>`).join("");
  };
  pad.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "OK"].map((key) => `<button type="button" data-pin="${key}">${key}</button>`).join("");
  redrawPin();
  pad.addEventListener("click", (event) => {
    const key = event.target.closest("button")?.dataset.pin;
    if (!key) return;
    if (key === "⌫") typed = typed.slice(0, -1);
    else if (key === "OK") {
      if (auth.checkPin(typed)) {
        lock.classList.remove("is-visible");
        toast("PIN принят");
      } else {
        typed = "";
        toast("Неверный PIN", "warn");
      }
    } else if (typed.length < 6) typed += key;
    redrawPin();
  });
  document.querySelector("#resetPinBtn").addEventListener("click", resetAll);
}

function bindGlobalEvents() {
  document.querySelector("#bottomNav").addEventListener("click", (event) => {
    const route = event.target.closest("button")?.dataset.route;
    if (route) setRoute(route);
  });
  document.querySelector("#fab").addEventListener("click", () => openModal("transaction"));
  document.querySelector("#themeToggle").addEventListener("click", async () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.settings.theme;
    await actions.importData({ ...state });
  });
  document.querySelector("#backupBtn").addEventListener("click", exportJson);
  document.querySelector("#importBtn").addEventListener("click", () => document.querySelector("#importInput").click());
  document.querySelector("#importInput").addEventListener("change", importJson);

  document.body.addEventListener("click", async (event) => {
    const openTarget = event.target.closest("[data-open]");
    const open = openTarget?.dataset.open;
    const jump = event.target.closest("[data-route-jump]")?.dataset.routeJump;
    const rename = event.target.closest("[data-action='rename-wallet']");
    const remove = event.target.closest("[data-action='delete-wallet']");
    const removeTx = event.target.closest("[data-action='delete-transaction']");
    const removeCrypto = event.target.closest("[data-action='delete-crypto']");
    const removeCryptoOperation = event.target.closest("[data-action='delete-crypto-operation']");
    if (open) openModal(open, {
      type: openTarget.dataset.presetType,
      category: openTarget.dataset.presetCategory,
      coinId: openTarget.dataset.coinId,
      symbol: openTarget.dataset.symbol
    });
    if (jump) setRoute(jump);
    if (rename) {
      const wallet = state.wallets.find((item) => item.id === rename.dataset.id);
      const name = prompt("Новое название кошелька", wallet?.name || "");
      if (name) {
        await actions.renameWallet(wallet.id, name);
        toast("Кошелек переименован");
      }
    }
    if (remove && confirm("Удалить кошелек? Операции останутся в истории.")) {
      await actions.deleteWallet(remove.dataset.id);
      toast("Кошелек удален");
    }
    if (removeTx && confirm("Удалить операцию и откатить баланс кошелька?")) {
      await actions.deleteTransaction(removeTx.dataset.id);
      toast("Операция удалена");
    }
    if (removeCrypto && confirm("Удалить эту криптовалюту из портфеля? История операций останется.")) {
      await actions.deleteCryptoAsset(removeCrypto.dataset.ids);
      toast("Криптоактив удален");
    }
    if (removeCryptoOperation && confirm("Удалить крипто-операцию и откатить изменения?")) {
      await actions.deleteCryptoOperation(removeCryptoOperation.dataset.id);
      toast("Крипто-операция удалена");
    }
  });

  document.body.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === "transfer") await actions.transfer(data.fromWalletId, data.toWalletId, data.amount);
    if (form.dataset.form === "exchange") await actions.exchange(data);
    form.reset();
    toast("Готово");
  });

  document.body.addEventListener("input", (event) => {
    if (event.target.id === "daysRange") {
      state.filters.analyticsDays = Number(event.target.value);
      render();
    }
    if (event.target.id === "txSearch") {
      state.filters.query = event.target.value;
      render();
    }
  });

  document.body.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-analytics-mode]")?.dataset.analyticsMode;
    if (mode) {
      state.filters.analyticsMode = mode;
      render();
    }
  });
}

function openModal(type, preset = {}) {
  const modal = document.querySelector("#entityModal");
  modal.innerHTML = modalMarkup(type, preset);
  refreshIcons();
  modal.showModal();
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (type === "wallet") await actions.addWallet(data);
    if (type === "transaction") await actions.addTransaction(data);
    if (type === "transfer") await actions.transfer(data.fromWalletId, data.toWalletId, data.amount);
    if (type === "crypto") await actions.addCrypto(data);
    if (type === "cryptoBuy") await actions.buyCrypto(data);
    if (type === "cryptoSell") await actions.sellCrypto(data);
    if (type === "cryptoSpend") await actions.spendCrypto(data);
    if (type === "cryptoTransfer") await actions.transferCrypto(data);
    if (type === "cryptoSwap") await actions.swapCrypto(data);
    if (type === "goal") await actions.addGoal(data);
    modal.close();
    toast("Сохранено");
  });
}

function modalMarkup(type, preset = {}) {
  const walletOptions = state.wallets.map((wallet) => `<option value="${wallet.id}">${wallet.name}</option>`).join("");
  const walletOptionsOptional = `<option value="">Не трогать фиатный кошелек</option>${walletOptions}`;
  const cryptoOptions = cryptoChoices(preset);
  const categoryOptions = state.categories.map((cat) => `<option value="${cat.name}" ${cat.name === preset.category ? "selected" : ""}>${cat.name}</option>`).join("");
  const typeOptions = [
    ["expense", "Расход"],
    ["income", "Доход"]
  ].map(([value, label]) => `<option value="${value}" ${value === preset.type ? "selected" : ""}>${label}</option>`).join("");
  const map = {
    wallet: ["Новый кошелек", `
      <label><span>Название</span><input name="name" required placeholder="Карта UAH" /></label>
      <label><span>Валюта</span><select name="currency"><option>UAH</option><option>USD</option><option>EUR</option></select></label>
      <label><span>Тип хранения</span><select name="type"><option>Карта</option><option>Наличные</option><option>Сбережения</option></select></label>
      <label><span>Баланс</span><input name="balance" inputmode="decimal" value="0" /></label>`],
    transaction: ["Операция", `
      <label><span>Тип</span><select name="type">${typeOptions}</select></label>
      <label><span>Кошелек</span><select name="walletId">${walletOptions}</select></label>
      <label><span>Категория</span><select name="category">${categoryOptions}</select></label>
      <label><span>Сумма</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Дата</span><input name="date" type="date" value="${isoDate()}" /></label>
      <label><span>Комментарий</span><input name="comment" placeholder="На что потратили?" /></label>
      <input type="hidden" name="currency" value="${state.wallets[0]?.currency || "UAH"}" />`],
    transfer: ["Перевод между кошельками", `
      <label><span>Откуда</span><select name="fromWalletId">${walletOptions}</select></label>
      <label><span>Куда</span><select name="toWalletId">${walletOptions}</select></label>
      <label><span>Сумма</span><input name="amount" inputmode="decimal" placeholder="0.00" required /></label>`],
    crypto: ["Добавить монету", `
      <label><span>CoinGecko ID</span><input name="coinId" placeholder="bitcoin" required /></label>
      <label><span>Тикер</span><input name="symbol" placeholder="BTC" required /></label>
      <label><span>Название</span><input name="name" placeholder="Bitcoin" required /></label>
      <label><span>Количество</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Средняя цена покупки USD</span><input name="avgBuy" inputmode="decimal" required /></label>
      <label><span>Биржа</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Комментарий</span><input name="note" /></label>`],
    cryptoBuy: ["Покупка крипты", `
      <label><span>CoinGecko ID</span><input name="coinId" value="${preset.coinId || ""}" placeholder="tether" required /></label>
      <label><span>Тикер</span><input name="symbol" value="${preset.symbol || ""}" placeholder="USDT" required /></label>
      <label><span>Название</span><input name="name" value="${preset.symbol || ""}" placeholder="Tether" /></label>
      <label><span>Количество монет</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Цена покупки за 1 монету, USD</span><input name="price" inputmode="decimal" required /></label>
      <label><span>Биржа / кошелек</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Фиатный кошелек списания</span><select name="walletId">${walletOptionsOptional}</select></label>
      <label><span>Списано с фиатного кошелька (можно пусто)</span><input name="fiatAmount" inputmode="decimal" placeholder="Авто по цене" /></label>
      <label><span>Комментарий</span><input name="note" /></label>`],
    cryptoSell: ["Продажа / обмен крипты в фиат", `
      <label><span>Монета</span><select name="coinId">${cryptoOptions}</select></label>
      <label><span>Тикер</span><input name="symbol" value="${preset.symbol || ""}" placeholder="USDT" /></label>
      <label><span>С какой биржи (можно пусто)</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Количество монет</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Цена продажи за 1 монету, USD</span><input name="price" inputmode="decimal" required /></label>
      <label><span>Фиатный кошелек получения</span><select name="walletId">${walletOptionsOptional}</select></label>
      <label><span>Получено в валюте кошелька (можно пусто)</span><input name="fiatAmount" inputmode="decimal" placeholder="Авто по цене" /></label>`],
    cryptoSpend: ["Расход криптой", `
      <label><span>Монета</span><select name="coinId">${cryptoOptions}</select></label>
      <label><span>Тикер</span><input name="symbol" value="${preset.symbol || ""}" placeholder="USDT" /></label>
      <label><span>С какой биржи (можно пусто)</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Количество монет</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Цена за 1 монету, USD</span><input name="price" inputmode="decimal" required /></label>
      <label><span>Категория расхода</span><select name="category">${categoryOptions}</select></label>
      <label><span>Комментарий</span><input name="comment" placeholder="Оплата с криптокошелька" /></label>`],
    cryptoTransfer: ["Перевод крипты между биржами", `
      <label><span>Монета</span><select name="coinId">${cryptoOptions}</select></label>
      <label><span>Тикер</span><input name="symbol" value="${preset.symbol || ""}" placeholder="USDT" /></label>
      <label><span>Откуда</span><input name="fromExchange" placeholder="Binance" /></label>
      <label><span>Куда</span><input name="toExchange" placeholder="Bybit" required /></label>
      <label><span>Количество монет</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Комментарий</span><input name="comment" /></label>`],
    cryptoSwap: ["Обмен крипты на крипту", `
      <label><span>Отдаю монету</span><select name="fromCoinId">${cryptoOptions}</select></label>
      <label><span>Тикер отдаю</span><input name="fromSymbol" value="${preset.symbol || ""}" placeholder="USDT" required /></label>
      <label><span>Количество отдаю</span><input name="fromAmount" inputmode="decimal" required /></label>
      <label><span>Цена за 1 монету (отдаю), USD</span><input name="fromPrice" inputmode="decimal" required /></label>
      <label><span>Получаю CoinGecko ID</span><input name="toCoinId" placeholder="ethereum" required /></label>
      <label><span>Тикер получаю</span><input name="toSymbol" placeholder="ETH" required /></label>
      <label><span>Название получаю</span><input name="toName" placeholder="Ethereum" /></label>
      <label><span>Количество получаю</span><input name="toAmount" inputmode="decimal" required /></label>
      <label><span>Цена за 1 монету (получаю), USD</span><input name="toPrice" inputmode="decimal" required /></label>
      <label><span>Биржа</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Дата</span><input name="date" type="date" value="${isoDate()}" /></label>
      <label><span>Комментарий</span><input name="comment" placeholder="Обмен USDT на ETH" /></label>`],
    goal: ["Новая цель", `
      <label><span>Название</span><input name="name" required placeholder="MacBook / отпуск / подушка" /></label>
      <label><span>Цель</span><input name="target" inputmode="decimal" required /></label>
      <label><span>Накоплено</span><input name="saved" inputmode="decimal" value="0" /></label>
      <label><span>Валюта</span><select name="currency"><option>USD</option><option>UAH</option><option>EUR</option></select></label>
      <label><span>Срок</span><input name="deadline" type="date" value="${isoDate(Date.now() + 100 * 86400000)}" /></label>`]
  };
  const [title, fields] = map[type];
  return `<form class="modal-card">
    <header><h2>${title}</h2><button class="icon-button" data-close type="button">${icon("x")}</button></header>
    <div class="form-grid">${fields}<button class="primary-button" type="submit">Сохранить</button></div>
  </form>`;
}

function cryptoChoices(preset = {}) {
  const seen = new Map();
  state.crypto.forEach((asset) => {
    const key = asset.coinId || asset.symbol;
    if (!key || seen.has(key)) return;
    seen.set(key, `${asset.name || asset.symbol} · ${asset.symbol}`);
  });
  if (preset.coinId && !seen.has(preset.coinId)) seen.set(preset.coinId, preset.symbol || preset.coinId);
  const options = [...seen.entries()].map(([value, label]) => `<option value="${value}" ${value === preset.coinId ? "selected" : ""}>${label}</option>`);
  return options.join("") || `<option value="${preset.coinId || ""}">${preset.symbol || "Сначала добавьте монету"}</option>`;
}

function renderCharts() {
  if (!window.Chart) return;
  charts.forEach((chart) => chart.destroy());
  charts.clear();
  const text = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  Chart.defaults.color = text;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";

  const categoryCanvas = document.querySelector("#categoryChart");
  if (categoryCanvas) {
    const rows = expenseByCategory(state, state.filters.analyticsDays, state.filters.analyticsMode);
    charts.set("category", new Chart(categoryCanvas, {
      type: "doughnut",
      data: { labels: rows.map((r) => r.category), datasets: [{ data: rows.map((r) => r.value), backgroundColor: rows.map((r) => r.color), borderWidth: 0 }] },
      options: { cutout: "68%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } }, animation: { duration: 900 } }
    }));
  }

  const flowCanvas = document.querySelector("#flowChart");
  if (flowCanvas) {
    const rows = dailyFlow(state, 14);
    charts.set("flow", new Chart(flowCanvas, {
      type: "bar",
      data: { labels: rows.map((r) => r.date.slice(5)), datasets: [
        { label: "Доход", data: rows.map((r) => r.income), backgroundColor: "#68fbd0", borderRadius: 8 },
        { label: "Расход", data: rows.map((r) => r.expense), backgroundColor: "#ff7da8", borderRadius: 8 }
      ] },
      options: { responsive: true, scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(255,255,255,.08)" } } } }
    }));
  }

  const capitalCanvas = document.querySelector("#capitalChart");
  if (capitalCanvas) {
    const rows = capitalSeries(state, 21);
    charts.set("capital", new Chart(capitalCanvas, {
      type: "line",
      data: { labels: rows.map((r) => r.label), datasets: [{ label: "Капитал", data: rows.map((r) => r.value), borderColor: "#7c5cff", backgroundColor: "rgba(124,92,255,.18)", fill: true, tension: 0.42, pointRadius: 0 }] },
      options: { scales: { x: { display: false }, y: { display: false } }, plugins: { legend: { display: false } } }
    }));
  }

  const allocationCanvas = document.querySelector("#allocationChart");
  if (allocationCanvas) {
    const rows = cryptoValue(state).rows;
    charts.set("allocation", new Chart(allocationCanvas, {
      type: "polarArea",
      data: { labels: rows.map((r) => r.symbol), datasets: [{ data: rows.map((r) => r.allocation), backgroundColor: ["#ffcc66", "#7c5cff", "#68fbd0", "#ff7da8"] }] },
      options: { plugins: { legend: { position: "bottom" } } }
    }));
  }
}

function renderSparklines() {
  document.querySelectorAll(".sparkline").forEach((canvas) => {
    const coin = state.market.coins?.[canvas.dataset.spark];
    const data = coin?.sparkline_in_7d?.price || [];
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data.length) return;
    const min = Math.min(...data);
    const max = Math.max(...data);
    ctx.strokeStyle = (coin.price_change_percentage_24h || 0) >= 0 ? "#68fbd0" : "#ff7da8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((value, index) => {
      const x = (index / (data.length - 1)) * canvas.width;
      const y = canvas.height - ((value - min) / Math.max(max - min, 0.0001)) * canvas.height;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
}

function enableDragSort() {
  let draggedId = null;
  document.querySelectorAll(".draggable-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      draggedId = card.dataset.id;
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", async () => {
      const targetId = card.dataset.id;
      if (!draggedId || draggedId === targetId) return;
      const from = state.wallets.findIndex((wallet) => wallet.id === draggedId);
      const to = state.wallets.findIndex((wallet) => wallet.id === targetId);
      const [item] = state.wallets.splice(from, 1);
      state.wallets.splice(to, 0, item);
      await actions.importData({ ...state });
      toast("Порядок карточек обновлен");
    });
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `finpulse-backup-${isoDate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup JSON создан");
}

async function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  await actions.importData(data);
  toast("Данные импортированы");
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
}
