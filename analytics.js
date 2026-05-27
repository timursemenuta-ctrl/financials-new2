import { convert } from "./api.js";
import { isoDate } from "./format.js";

export function walletTotals(state) {
  const fiatUsd = state.wallets.reduce((sum, wallet) => sum + convert(wallet.balance, wallet.currency, "USD", state.rates), 0);
  const fiatUah = state.wallets.reduce((sum, wallet) => sum + convert(wallet.balance, wallet.currency, "UAH", state.rates), 0);
  const cryptoUsd = cryptoValue(state).total;
  return { fiatUsd, fiatUah, cryptoUsd, totalUsd: fiatUsd + cryptoUsd, totalUah: convert(fiatUsd + cryptoUsd, "USD", "UAH", state.rates) };
}

export function cryptoValue(state) {
  const rawRows = state.crypto.map((asset) => {
    const market = state.market.coins?.[asset.coinId] || {};
    const price = market.current_price || asset.avgBuy;
    const value = asset.amount * price;
    const cost = asset.amount * asset.avgBuy;
    return {
      ...asset,
      market,
      price,
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost ? ((value - cost) / cost) * 100 : 0
    };
  });

  const grouped = new Map();
  rawRows.forEach((row) => {
    const key = (row.coinId || row.symbol || row.name).toLowerCase();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        ids: [row.id],
        exchanges: row.exchange ? [row.exchange] : [],
        notes: row.note ? [row.note] : []
      });
      return;
    }

    existing.ids.push(row.id);
    existing.amount += row.amount;
    existing.value += row.value;
    existing.cost += row.cost;
    existing.avgBuy = existing.amount ? existing.cost / existing.amount : 0;
    existing.pnl = existing.value - existing.cost;
    existing.pnlPct = existing.cost ? (existing.pnl / existing.cost) * 100 : 0;
    if (row.exchange && !existing.exchanges.includes(row.exchange)) existing.exchanges.push(row.exchange);
    if (row.note) existing.notes.push(row.note);
  });

  const rows = [...grouped.values()].sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return { total, rows: rows.map((row) => ({ ...row, allocation: total ? (row.value / total) * 100 : 0 })) };
}

export function expenseByCategory(state, days = 30, mode = "all") {
  const since = Date.now() - days * 86400000;
  const map = new Map();
  state.transactions
    .filter((tx) => tx.type === "expense" && new Date(tx.date).getTime() >= since)
    .filter((tx) => mode === "all" || (mode === "crypto" ? tx.category === "Крипта" : tx.category !== "Крипта"))
    .forEach((tx) => {
      const usd = convert(tx.amount, tx.currency, "USD", state.rates);
      const item = map.get(tx.category) || { category: tx.category, value: 0, color: tx.color, icon: tx.icon };
      item.value += usd;
      map.set(tx.category, item);
    });
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function dailyFlow(state, days = 14) {
  const labels = Array.from({ length: days }, (_, i) => isoDate(Date.now() - (days - i - 1) * 86400000));
  return labels.map((date) => {
    const dayTx = state.transactions.filter((tx) => tx.date === date);
    const income = dayTx.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + convert(tx.amount, tx.currency, "USD", state.rates), 0);
    const expense = dayTx.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + convert(tx.amount, tx.currency, "USD", state.rates), 0);
    return { date, income, expense, cashflow: income - expense };
  });
}

export function monthlyStats(state) {
  const map = new Map();
  state.transactions.forEach((tx) => {
    const key = tx.date.slice(0, 7);
    const item = map.get(key) || { month: key, income: 0, expense: 0 };
    if (tx.type === "income") item.income += convert(tx.amount, tx.currency, "USD", state.rates);
    if (tx.type === "expense") item.expense += convert(tx.amount, tx.currency, "USD", state.rates);
    map.set(key, item);
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function activityHeatmap(state, days = 35) {
  return Array.from({ length: days }, (_, i) => {
    const date = isoDate(Date.now() - (days - i - 1) * 86400000);
    const value = state.transactions
      .filter((tx) => tx.date === date)
      .reduce((sum, tx) => sum + (tx.type === "expense" ? convert(tx.amount, tx.currency, "USD", state.rates) : 0), 0);
    return { date, value };
  });
}

export function capitalSeries(state, days = 21) {
  const current = walletTotals(state).totalUsd;
  return Array.from({ length: days }, (_, i) => {
    const drift = Math.sin(i / 2.5) * 120 + i * 22;
    return { label: `${i + 1}`, value: current - (days - i) * 18 + drift };
  });
}

export function averageDailyExpense(state, days = 30) {
  const total = expenseByCategory(state, days).reduce((sum, item) => sum + item.value, 0);
  return total / days;
}
