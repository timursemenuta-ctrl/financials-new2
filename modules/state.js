import { getRates, getCryptoMarket } from "./api.js";
import { clearDb, getRecord, preferences, setRecord } from "./db.js";
import { demoData } from "./data.js";
import { uid } from "./format.js";

const DATA_KEY = "appData";
const listeners = new Set();
const DEFAULT_RATES = { USD_UAH: 40.2, EUR_UAH: 43.6, EUR_USD: 1.08, updatedAt: null, offline: true };

export const state = {
  route: "home",
  unlocked: false,
  rates: {},
  market: { coins: {} },
  wallets: [],
  transactions: [],
  exchanges: [],
  crypto: [],
  goals: [],
  categories: [],
  settings: { theme: "dark", baseCurrency: "USD" },
  filters: { query: "", analyticsMode: "all", analyticsDays: 30 }
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach((listener) => listener(state));
}

export async function initState() {
  const saved = await getRecord(DATA_KEY);
  const shouldReplaceOldDemo = saved?.meta?.seeded && saved?.meta?.seedProfile !== "zero-v1";
  Object.assign(state, shouldReplaceOldDemo ? demoData() : saved || demoData());
  state.settings.theme = preferences.get("theme", state.settings.theme || "dark");
  state.rates = await getRecord("rates", DEFAULT_RATES);
  state.market = await getRecord("cryptoMarket", { updatedAt: null, offline: true, coins: {} });
  await persist();
  refreshRemote().catch(() => notify());
  notify();
}

export async function refreshRemote() {
  state.rates = await getRates();
  state.market = await getCryptoMarket(state.crypto.map((asset) => asset.coinId));
  await persist();
  notify();
}

export async function persist() {
  const payload = {
    meta: state.meta,
    settings: state.settings,
    wallets: state.wallets,
    transactions: state.transactions,
    exchanges: state.exchanges,
    crypto: state.crypto,
    goals: state.goals,
    categories: state.categories
  };
  preferences.set("theme", state.settings.theme);
  await setRecord(DATA_KEY, payload);
}

export async function resetAll() {
  await clearDb();
  ["pin", "onboarded", "theme"].forEach((key) => preferences.remove(key));
  location.reload();
}

export async function mutate(fn) {
  fn(state);
  await persist();
  notify();
}

export function setRoute(route) {
  state.route = route;
  notify();
}

export const auth = {
  hasPin: () => Boolean(preferences.get("pin")),
  isOnboarded: () => Boolean(preferences.get("onboarded")),
  setPin(pin) {
    preferences.set("pin", btoa(pin));
    preferences.set("onboarded", true);
  },
  checkPin(pin) {
    return preferences.get("pin") === btoa(pin);
  }
};

export const actions = {
  addWallet(data) {
    return mutate((draft) => draft.wallets.push({ id: uid("w"), color: "#68fbd0", balance: 0, ...data, balance: Number(data.balance || 0) }));
  },
  deleteWallet(id) {
    return mutate((draft) => {
      draft.wallets = draft.wallets.filter((wallet) => wallet.id !== id);
    });
  },
  renameWallet(id, name) {
    return mutate((draft) => {
      const wallet = draft.wallets.find((item) => item.id === id);
      if (wallet) wallet.name = name;
    });
  },
  addTransaction(data) {
    return mutate((draft) => {
      const wallet = draft.wallets.find((item) => item.id === data.walletId);
      const category = draft.categories.find((item) => item.name === data.category) || draft.categories[draft.categories.length - 1];
      const amount = Number(data.amount || 0);
      if (wallet) wallet.balance += data.type === "income" ? amount : -amount;
      draft.transactions.unshift({ id: uid("tx"), icon: category.icon, color: category.color, ...data, currency: wallet?.currency || data.currency, amount });
    });
  },
  transfer(fromWalletId, toWalletId, amount) {
    return mutate((draft) => {
      const from = draft.wallets.find((wallet) => wallet.id === fromWalletId);
      const to = draft.wallets.find((wallet) => wallet.id === toWalletId);
      const value = Number(amount || 0);
      if (!from || !to || from.id === to.id) return;
      from.balance -= value;
      to.balance += value;
      draft.transactions.unshift({ id: uid("tx"), type: "transfer", amount: value, currency: from.currency, date: new Date().toISOString().slice(0, 10), walletId: from.id, toWalletId: to.id, category: "Другое", icon: "repeat-2", color: "#d1d5db", comment: `Перевод в ${to.name}` });
    });
  },
  exchange(data) {
    return mutate((draft) => {
      const from = draft.wallets.find((wallet) => wallet.id === data.fromWalletId);
      const to = draft.wallets.find((wallet) => wallet.id === data.toWalletId);
      const fromAmount = Number(data.fromAmount || 0);
      const toAmount = Number(data.toAmount || 0);
      if (!from || !to || from.id === to.id) return;
      from.balance -= fromAmount;
      to.balance += toAmount;
      const item = { id: uid("ex"), date: data.date, fromWalletId: from.id, toWalletId: to.id, fromAmount, toAmount, fromCurrency: from.currency, toCurrency: to.currency, rate: fromAmount / Math.max(toAmount, 0.000001) };
      draft.exchanges.unshift(item);
      draft.transactions.unshift({ id: uid("tx"), type: "exchange", amount: fromAmount, currency: from.currency, date: data.date, walletId: from.id, toWalletId: to.id, toAmount, toCurrency: to.currency, category: "Другое", icon: "repeat-2", color: "#66a6ff", comment: `Обмен ${from.currency} на ${to.currency}` });
    });
  },
  addCrypto(data) {
    return mutate((draft) => draft.crypto.push({ id: uid("c"), ...data, amount: Number(data.amount || 0), avgBuy: Number(data.avgBuy || 0) }));
  },
  addGoal(data) {
    return mutate((draft) => draft.goals.push({ id: uid("g"), color: "#ffcc66", ...data, target: Number(data.target || 0), saved: Number(data.saved || 0) }));
  },
  importData(data) {
    return mutate((draft) => Object.assign(draft, data));
  }
};
