import { convert } from "./api.js";
import { activityHeatmap, averageDailyExpense, capitalSeries, cryptoValue, dailyFlow, expenseByCategory, monthlyStats, walletTotals } from "./analytics.js";
import { clamp, dateLabel, daysBetween, isoDate, money, number, percent } from "./format.js";

export function icon(name, className = "") {
  return `<i class="${className}" data-lucide="${name}"></i>`;
}

export function section(title, content, action = "") {
  return `<section class="panel"><div class="section-head"><h2>${title}</h2>${action}</div>${content}</section>`;
}

export function walletCard(wallet, state) {
  const usd = convert(wallet.balance, wallet.currency, "USD", state.rates);
  const uah = convert(wallet.balance, wallet.currency, "UAH", state.rates);
  return `
    <article class="wallet-card draggable-card" draggable="true" data-id="${wallet.id}">
      <div class="card-shine" style="--accent:${wallet.color}"></div>
      <div class="wallet-row">
        <span class="coin-badge" style="--accent:${wallet.color}">${wallet.currency}</span>
        <div class="mini-actions">
          <button class="ghost-icon" data-action="rename-wallet" data-id="${wallet.id}" type="button">${icon("pencil")}</button>
          <button class="ghost-icon" data-action="delete-wallet" data-id="${wallet.id}" type="button">${icon("trash-2")}</button>
        </div>
      </div>
      <h3>${wallet.name}</h3>
      <strong>${money(wallet.balance, wallet.currency)}</strong>
      <small>${money(usd, "USD")} · ${money(uah, "UAH", true)}</small>
      <span class="pill">${wallet.type}</span>
    </article>
  `;
}

export function transactionRow(tx) {
  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
  const amountLabel = tx.type === "transfer" ? money(tx.amount, tx.currency) : `${sign}${money(tx.amount, tx.currency)}`;
  return `
    <article class="transaction-row">
      <span class="tx-icon" style="--accent:${tx.color}">${icon(tx.icon || "circle-dot")}</span>
      <div>
        <strong>${tx.category}</strong>
        <small>${tx.comment || "Без комментария"} · ${dateLabel(tx.date)}</small>
      </div>
      <div class="tx-side">
        <b class="${tx.type === "income" ? "positive" : tx.type === "expense" ? "negative" : ""}">${amountLabel}</b>
        <button class="ghost-icon danger" data-action="delete-transaction" data-id="${tx.id}" type="button">${icon("trash-2")}</button>
      </div>
    </article>
  `;
}

export function goalCard(goal) {
  const progress = clamp((goal.saved / goal.target) * 100, 0, 100);
  const daily = Math.max(0, (goal.target - goal.saved) / daysBetween(Date.now(), goal.deadline));
  return `
    <article class="goal-card">
      <div>
        <strong>${goal.name}</strong>
        <small>До ${dateLabel(goal.deadline)} · нужно ${money(daily, goal.currency)} / день</small>
      </div>
      <div class="progress-line"><span style="width:${progress}%; --accent:${goal.color}"></span></div>
      <footer><b>${number(progress, 0)}%</b><span>${money(goal.saved, goal.currency)} из ${money(goal.target, goal.currency)}</span></footer>
    </article>
  `;
}

export function ratesStrip(state) {
  const items = [
    ["USD/UAH", state.rates.USD_UAH],
    ["EUR/UAH", state.rates.EUR_UAH],
    ["EUR/USD", state.rates.EUR_USD]
  ];
  return `<div class="rates-strip">${items.map(([label, value]) => `<div><span>${label}</span><strong>${number(value, 3)}</strong></div>`).join("")}</div>`;
}

export function homeView(state) {
  const totals = walletTotals(state);
  const crypto = cryptoValue(state);
  const fiatPart = totals.totalUsd ? (totals.fiatUsd / totals.totalUsd) * 100 : 0;
  const cryptoPart = totals.totalUsd ? (totals.cryptoUsd / totals.totalUsd) * 100 : 0;
  const todayChange = state.transactions
    .filter((tx) => tx.date === isoDate() && (tx.type === "income" || tx.type === "expense"))
    .reduce((sum, tx) => sum + (tx.type === "income" ? 1 : -1) * convert(tx.amount, tx.currency, "USD", state.rates), 0);
  const query = state.filters.query.trim().toLowerCase();
  const last = state.transactions
    .filter((tx) => !query || `${tx.category} ${tx.comment} ${tx.currency}`.toLowerCase().includes(query))
    .slice(0, 5)
    .map(transactionRow)
    .join("");
  return `
    <section class="hero-card">
      <div class="hero-grid"></div>
      <span class="eyebrow">Общий капитал</span>
      <h1>${money(totals.totalUsd, "USD")}</h1>
      <p>${money(totals.totalUah, "UAH", true)} · за день <b class="${todayChange >= 0 ? "positive" : "negative"}">${todayChange >= 0 ? "+" : ""}${money(todayChange, "USD")}</b></p>
      <div class="capital-mix">
        <span style="width:${fiatPart}%"></span>
        <span style="width:${cryptoPart}%"></span>
      </div>
      <div class="hero-stats">
        <div><span>Фиат</span><strong>${money(totals.fiatUsd, "USD")}</strong></div>
        <div><span>Крипта</span><strong>${money(totals.cryptoUsd, "USD")}</strong></div>
      </div>
    </section>
    ${section("Быстрые действия", `<div class="quick-actions">
      <button data-open="transaction" type="button">${icon("plus")}Операция</button>
      <button data-open="wallet" type="button">${icon("wallet")}Кошелек</button>
      <button data-open="transfer" type="button">${icon("send")}Перевод</button>
      <button data-route-jump="exchange" type="button">${icon("repeat-2")}Обмен</button>
      <button data-open="goal" type="button">${icon("target")}Цель</button>
    </div>`)}
    ${section("Кошельки", `<div class="wallet-scroll">${state.wallets.map((wallet) => walletCard(wallet, state)).join("")}</div>`)}
    ${section("Курсы валют", ratesStrip(state))}
    ${section("Мини криптопортфель", `<div class="mini-crypto">${crypto.rows.slice(0, 3).map((row) => `
      <div><span>${row.symbol}</span><strong>${money(row.value, "USD")}</strong><small class="${row.pnlPct >= 0 ? "positive" : "negative"}">${percent(row.pnlPct)}</small></div>
    `).join("")}</div>`)}
    ${section("Календарь трат", heatmap(activityHeatmap(state, 28)))}
    ${section("Цели накоплений", `<div class="goal-list">${state.goals.map(goalCard).join("")}</div>`)}
    ${section("Последние операции", `<label class="search-field"><span>Поиск операций</span><input id="txSearch" value="${state.filters.query}" placeholder="Еда, подписки, USD..." /></label><div class="transaction-list">${last || "<p class='empty'>Ничего не найдено</p>"}</div>`)}
  `;
}

export function walletsView(state) {
  return `
    ${section("Кошельки и балансы", `<div class="wallet-grid">${state.wallets.map((wallet) => walletCard(wallet, state)).join("")}</div>`, `<button class="small-button" data-open="wallet" type="button">${icon("plus")}Добавить</button>`)}
    ${section("Перевод между кошельками", transferForm(state))}
    ${section("Цели накоплений", `<div class="goal-list">${state.goals.map(goalCard).join("")}</div>`, `<button class="small-button" data-open="goal" type="button">${icon("plus")}Цель</button>`)}
  `;
}

export function exchangeView(state) {
  return `
    ${section("Обмен валют", exchangeForm(state))}
    ${section("История обменов", `<div class="transaction-list">${state.exchanges.map((ex) => `
      <article class="transaction-row">
        <span class="tx-icon">${icon("repeat-2")}</span>
        <div><strong>${ex.fromCurrency} → ${ex.toCurrency}</strong><small>${dateLabel(ex.date)} · курс ${number(ex.rate, 4)}</small></div>
        <b>${number(ex.fromAmount)} → ${number(ex.toAmount)}</b>
      </article>
    `).join("")}</div>`)}
  `;
}

export function analyticsView(state) {
  const categories = expenseByCategory(state, state.filters.analyticsDays, state.filters.analyticsMode);
  const flow = dailyFlow(state, 14);
  const months = monthlyStats(state);
  return `
    ${section("Фильтры", `<div class="segmented">
      ${["all:Вместе", "fiat:Фиат", "crypto:Крипта"].map((item) => {
        const [value, label] = item.split(":");
        return `<button data-analytics-mode="${value}" class="${state.filters.analyticsMode === value ? "is-active" : ""}" type="button">${label}</button>`;
      }).join("")}
    </div><div class="range-row"><span>Период: ${state.filters.analyticsDays} дней</span><input type="range" min="7" max="90" step="1" value="${state.filters.analyticsDays}" id="daysRange" /></div>`)}
    <section class="panel analytics-summary">
      <div><span>Средний расход</span><strong>${money(averageDailyExpense(state, state.filters.analyticsDays), "USD")}</strong><small>в день</small></div>
      <div><span>Cashflow</span><strong class="${flow.reduce((s, d) => s + d.cashflow, 0) >= 0 ? "positive" : "negative"}">${money(flow.reduce((s, d) => s + d.cashflow, 0), "USD")}</strong><small>14 дней</small></div>
    </section>
    ${chartPanel("Расходы по категориям", "categoryChart")}
    ${chartPanel("Доходы и расходы по дням", "flowChart")}
    ${chartPanel("Изменение капитала", "capitalChart")}
    ${section("Активность", heatmap(activityHeatmap(state, 35)))}
    ${section("Самые затратные категории", `<div class="rank-list">${categories.slice(0, 6).map((item, index) => `
      <div><span>${index + 1}</span><strong>${item.category}</strong><b>${money(item.value, "USD")}</b></div>
    `).join("")}</div>`)}
    ${section("Статистика по месяцам", `<div class="rank-list">${months.map((item) => `
      <div><span>${item.month}</span><strong>${money(item.income - item.expense, "USD")}</strong><b>${money(item.expense, "USD")}</b></div>
    `).join("")}</div>`)}
  `;
}

export function cryptoView(state) {
  const portfolio = cryptoValue(state);
  return `
    <section class="hero-card crypto-hero">
      <span class="eyebrow">Криптопортфель</span>
      <h1>${money(portfolio.total, "USD")}</h1>
      <p>${money(convert(portfolio.total, "USD", "UAH", state.rates), "UAH", true)} · обновление ${state.market.offline ? "из кеша" : "онлайн"}</p>
    </section>
    ${section("Крипто-операции", `<div class="quick-actions">
      <button data-open="cryptoBuy" type="button">${icon("plus")}Покупка</button>
      <button data-open="cryptoSell" type="button">${icon("trending-up")}Продажа</button>
      <button data-open="cryptoSwap" type="button">${icon("repeat-2")}Обмен</button>
      <button data-open="cryptoSpend" type="button">${icon("shopping-bag")}Расход</button>
      <button data-open="cryptoTransfer" type="button">${icon("send")}Перевод</button>
      <button data-open="crypto" type="button">${icon("bitcoin")}Ручной актив</button>
      <button data-route-jump="analytics" type="button">${icon("chart-no-axes-combined")}Аналитика</button>
    </div>`)}
    ${section("Активы", `<div class="crypto-list">${portfolio.rows.map((row) => cryptoRow(row, state)).join("") || "<p class='empty'>Добавьте первую монету или покупку</p>"}</div>`, `<button class="small-button" data-open="cryptoBuy" type="button">${icon("plus")}Купить</button>`)}
    ${chartPanel("Allocation", "allocationChart")}
    ${section("История крипты", `<div class="transaction-list">${(state.cryptoTransactions || []).slice(0, 8).map(cryptoTxRow).join("") || "<p class='empty'>Операций пока нет</p>"}</div>`)}
    ${section("Top movers", `<div class="mover-grid">${Object.values(state.market.coins || {}).slice(0, 6).map((coin) => `
      <div><span>${coin.symbol?.toUpperCase()}</span><strong>${money(coin.current_price, "USD")}</strong><small class="${coin.price_change_percentage_24h >= 0 ? "positive" : "negative"}">${percent(coin.price_change_percentage_24h || 0)}</small></div>
    `).join("")}</div>`)}
  `;
}

function cryptoRow(row, state) {
  const exchanges = row.exchanges?.length ? row.exchanges.join(" + ") : row.exchange || "Биржа не указана";
  return `
    <article class="crypto-row">
      <img src="${row.market.image || ""}" alt="" />
      <div>
        <strong>${row.name}</strong>
        <small>${exchanges} · ${number(row.amount, 6)} ${row.symbol}</small>
        <small>Средняя ${money(row.avgBuy, "USD")} · PnL <span class="${row.pnl >= 0 ? "positive" : "negative"}">${money(row.pnl, "USD")} / ${percent(row.pnlPct)}</span></small>
      </div>
      <canvas class="sparkline" data-spark="${row.coinId}" width="88" height="36"></canvas>
      <div class="right">
        <b>${money(row.value, "USD")}</b>
        <small>${money(convert(row.value, "USD", "UAH", state.rates), "UAH", true)}</small>
        <em class="${row.pnl >= 0 ? "positive" : "negative"}">${percent(row.pnlPct)}</em>
        <div class="mini-actions right-actions">
          <button class="ghost-icon" data-open="cryptoSwap" data-coin-id="${row.coinId}" data-symbol="${row.symbol}" type="button">${icon("repeat-2")}</button>
          <button class="ghost-icon" data-open="cryptoSell" data-coin-id="${row.coinId}" data-symbol="${row.symbol}" type="button">${icon("trending-up")}</button>
          <button class="ghost-icon" data-open="cryptoSpend" data-coin-id="${row.coinId}" data-symbol="${row.symbol}" type="button">${icon("shopping-bag")}</button>
          <button class="ghost-icon" data-open="cryptoTransfer" data-coin-id="${row.coinId}" data-symbol="${row.symbol}" type="button">${icon("send")}</button>
          <button class="ghost-icon danger" data-action="delete-crypto" data-ids="${row.ids?.join(",") || row.id}" type="button">${icon("trash-2")}</button>
        </div>
      </div>
    </article>
  `;
}

function cryptoTxRow(tx) {
  const labels = { buy: "Покупка", sell: "Продажа", spend: "Расход", transfer: "Перевод", swap: "Обмен" };
  const pnl = typeof tx.pnl === "number" ? ` · PnL ${money(tx.pnl, "USD")}` : "";
  const swapInfo = tx.type === "swap" ? `${tx.fromSymbol} → ${tx.toSymbol}` : tx.symbol || "";
  return `
    <article class="transaction-row">
      <span class="tx-icon">${icon(tx.type === "sell" ? "trending-up" : tx.type === "spend" ? "shopping-bag" : tx.type === "transfer" ? "send" : tx.type === "swap" ? "repeat-2" : "bitcoin")}</span>
      <div>
        <strong>${labels[tx.type] || "Крипто"} ${swapInfo}</strong>
        <small>${dateLabel(tx.date)} · ${tx.type === "swap" ? `${number(tx.fromAmount || 0, 6)} → ${number(tx.toAmount || 0, 6)}` : number(tx.amount || 0, 6)}${pnl}</small>
      </div>
      <div class="tx-side">
        <b>${tx.type === "swap" ? money(tx.toValueUsd || 0, "USD") : tx.valueUsd ? money(tx.valueUsd, "USD") : tx.toExchange || ""}</b>
        <button class="ghost-icon danger" data-action="delete-crypto-operation" data-id="${tx.id}" type="button">${icon("trash-2")}</button>
      </div>
    </article>
  `;
}

function chartPanel(title, id) {
  return section(title, `<div class="chart-box"><canvas id="${id}"></canvas></div>`);
}

function heatmap(items) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return `<div class="heatmap">${items.map((item) => `<span title="${item.date}" style="--level:${item.value / max}"></span>`).join("")}</div>`;
}

function walletOptions(state) {
  return state.wallets.map((wallet) => `<option value="${wallet.id}">${wallet.name} · ${wallet.currency}</option>`).join("");
}

function transferForm(state) {
  return `<form class="form-grid" data-form="transfer">
    <label><span>Откуда</span><select name="fromWalletId">${walletOptions(state)}</select></label>
    <label><span>Куда</span><select name="toWalletId">${walletOptions(state)}</select></label>
    <label><span>Сумма</span><input name="amount" inputmode="decimal" placeholder="0.00" required /></label>
    <button class="primary-button" type="submit">Перевести</button>
  </form>`;
}

function exchangeForm(state) {
  return `<form class="form-grid" data-form="exchange">
    <label><span>Отдаю</span><select name="fromWalletId">${walletOptions(state)}</select></label>
    <label><span>Получаю</span><select name="toWalletId">${walletOptions(state)}</select></label>
    <label><span>Сумма отдаю</span><input name="fromAmount" inputmode="decimal" placeholder="20000" required /></label>
    <label><span>Сумма получил</span><input name="toAmount" inputmode="decimal" placeholder="490" required /></label>
    <label><span>Дата</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
    <button class="primary-button" type="submit">Сохранить обмен</button>
  </form>`;
}
