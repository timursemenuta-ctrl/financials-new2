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
    const open = event.target.closest("[data-open]")?.dataset.open;
    const jump = event.target.closest("[data-route-jump]")?.dataset.routeJump;
    const rename = event.target.closest("[data-action='rename-wallet']");
    const remove = event.target.closest("[data-action='delete-wallet']");
    if (open) openModal(open);
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

function openModal(type) {
  const modal = document.querySelector("#entityModal");
  modal.innerHTML = modalMarkup(type);
  refreshIcons();
  modal.showModal();
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (type === "wallet") await actions.addWallet(data);
    if (type === "transaction") await actions.addTransaction(data);
    if (type === "crypto") await actions.addCrypto(data);
    if (type === "goal") await actions.addGoal(data);
    modal.close();
    toast("Сохранено");
  });
}

function modalMarkup(type) {
  const walletOptions = state.wallets.map((wallet) => `<option value="${wallet.id}">${wallet.name}</option>`).join("");
  const categoryOptions = state.categories.map((cat) => `<option value="${cat.name}">${cat.name}</option>`).join("");
  const map = {
    wallet: ["Новый кошелек", `
      <label><span>Название</span><input name="name" required placeholder="Карта UAH" /></label>
      <label><span>Валюта</span><select name="currency"><option>UAH</option><option>USD</option><option>EUR</option></select></label>
      <label><span>Тип хранения</span><select name="type"><option>Карта</option><option>Наличные</option><option>Сбережения</option></select></label>
      <label><span>Баланс</span><input name="balance" inputmode="decimal" value="0" /></label>`],
    transaction: ["Операция", `
      <label><span>Тип</span><select name="type"><option value="expense">Расход</option><option value="income">Доход</option></select></label>
      <label><span>Кошелек</span><select name="walletId">${walletOptions}</select></label>
      <label><span>Категория</span><select name="category">${categoryOptions}</select></label>
      <label><span>Сумма</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Дата</span><input name="date" type="date" value="${isoDate()}" /></label>
      <label><span>Комментарий</span><input name="comment" placeholder="На что потратили?" /></label>
      <input type="hidden" name="currency" value="${state.wallets[0]?.currency || "UAH"}" />`],
    crypto: ["Добавить монету", `
      <label><span>CoinGecko ID</span><input name="coinId" placeholder="bitcoin" required /></label>
      <label><span>Тикер</span><input name="symbol" placeholder="BTC" required /></label>
      <label><span>Название</span><input name="name" placeholder="Bitcoin" required /></label>
      <label><span>Количество</span><input name="amount" inputmode="decimal" required /></label>
      <label><span>Средняя цена покупки USD</span><input name="avgBuy" inputmode="decimal" required /></label>
      <label><span>Биржа</span><input name="exchange" placeholder="Binance" /></label>
      <label><span>Комментарий</span><input name="note" /></label>`],
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
