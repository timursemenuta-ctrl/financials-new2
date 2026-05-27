import { convert, getRates, getCryptoMarket } from "./api.js";
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
  cryptoTransactions: [],
  goals: [],
  categories: [],
  settings: { theme: "dark", baseCurrency: "USD" },
  filters: { query: "", analyticsMode: "all", analyticsDays: 30, balancePeriod: 30 }
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
  state.cryptoTransactions ||= [];
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
    cryptoTransactions: state.cryptoTransactions,
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
  deleteTransaction(id) {
    return mutate((draft) => {
      const tx = draft.transactions.find((item) => item.id === id);
      if (!tx) return;

      const wallet = draft.wallets.find((item) => item.id === tx.walletId);
      const toWallet = draft.wallets.find((item) => item.id === tx.toWalletId);
      if (tx.cryptoTxId) {
        rollbackCryptoOperation(draft, tx.cryptoTxId);
        draft.transactions = draft.transactions.filter((item) => item.id !== id);
        draft.cryptoTransactions = draft.cryptoTransactions.filter((item) => item.id !== tx.cryptoTxId);
        return;
      }
      if (wallet && tx.type === "income") wallet.balance -= Number(tx.amount || 0);
      if (wallet && tx.type === "expense") wallet.balance += Number(tx.amount || 0);
      if (wallet && tx.type === "transfer") wallet.balance += Number(tx.amount || 0);
      if (toWallet && tx.type === "transfer") toWallet.balance -= Number(tx.amount || 0);
      if (wallet && tx.type === "exchange") wallet.balance += Number(tx.amount || 0);
      if (toWallet && tx.type === "exchange") toWallet.balance -= Number(tx.toAmount || 0);

      draft.transactions = draft.transactions.filter((item) => item.id !== id);
      draft.cryptoTransactions = draft.cryptoTransactions.filter((item) => item.id !== tx.cryptoTxId);
      if (tx.type === "exchange") {
        draft.exchanges = draft.exchanges.filter((item) => !(item.date === tx.date && item.fromWalletId === tx.walletId && item.toWalletId === tx.toWalletId && Number(item.fromAmount) === Number(tx.amount)));
      }
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
    return mutate((draft) => draft.crypto.push({
      id: uid("c"),
      ...data,
      coinId: String(data.coinId || "").trim().toLowerCase(),
      symbol: String(data.symbol || "").trim().toUpperCase(),
      amount: Number(data.amount || 0),
      avgBuy: Number(data.avgBuy || 0)
    }));
  },
  deleteCryptoAsset(ids) {
    const idList = String(ids || "").split(",").filter(Boolean);
    return mutate((draft) => {
      draft.crypto = draft.crypto.filter((asset) => !idList.includes(asset.id));
    });
  },
  buyCrypto(data) {
    return mutate((draft) => {
      const amount = Number(data.amount || 0);
      const price = Number(data.price || data.avgBuy || 0);
      const wallet = draft.wallets.find((item) => item.id === data.walletId);
      const fiatAmount = Number(data.fiatAmount || (wallet ? convert(amount * price, "USD", wallet.currency, draft.rates) : 0));
      const asset = normalizeCryptoAsset({ ...data, amount, avgBuy: price });
      const cryptoTxId = uid("ctx");

      draft.crypto.push(asset);
      if (wallet && fiatAmount) wallet.balance -= fiatAmount;

      const tx = linkedTransaction(draft, cryptoTxId, {
        type: "transfer",
        amount: fiatAmount || amount * price,
        currency: wallet?.currency || "USD",
        walletId: wallet?.id,
        category: "Крипта",
        icon: "bitcoin",
        color: "#ffcc66",
        comment: `Покупка ${amount} ${asset.symbol}`
      });
      draft.transactions.unshift(tx);
      draft.cryptoTransactions.unshift({
        id: cryptoTxId,
        type: "buy",
        date: tx.date,
        asset,
        walletId: wallet?.id,
        fiatAmount,
        fiatCurrency: wallet?.currency,
        transactionId: tx.id
      });
    });
  },
  sellCrypto(data) {
    return mutate((draft) => {
      const requestedAmount = Number(data.amount || 0);
      const price = Number(data.price || 0);
      const wallet = draft.wallets.find((item) => item.id === data.walletId);
      const reductions = reduceCrypto(draft, data.coinId, requestedAmount, data.exchange);
      const amount = reductions.reduce((sum, item) => sum + item.amount, 0);
      if (!amount) return;
      const meta = cryptoMetaFrom(draft, data, reductions);
      const fiatAmount = Number(data.fiatAmount || (wallet ? convert(amount * price, "USD", wallet.currency, draft.rates) : amount * price));
      const cost = reductions.reduce((sum, item) => sum + item.amount * item.avgBuy, 0);
      const valueUsd = amount * price;
      const pnl = valueUsd - cost;
      const cryptoTxId = uid("ctx");

      if (wallet && fiatAmount) wallet.balance += fiatAmount;
      const tx = linkedTransaction(draft, cryptoTxId, {
        type: pnl >= 0 ? "income" : "expense",
        amount: Math.abs(pnl),
        currency: "USD",
        walletId: wallet?.id,
        category: "Крипта",
        icon: "trending-up",
        color: pnl >= 0 ? "#68fbd0" : "#ff7da8",
        comment: `${pnl >= 0 ? "Прибыль" : "Убыток"} от продажи ${amount} ${meta.symbol || meta.coinId}`
      });
      draft.transactions.unshift(tx);
      draft.cryptoTransactions.unshift({
        id: cryptoTxId,
        type: "sell",
        date: tx.date,
        coinId: meta.coinId,
        symbol: meta.symbol,
        amount,
        price,
        valueUsd,
        cost,
        pnl,
        reductions,
        walletId: wallet?.id,
        fiatAmount,
        fiatCurrency: wallet?.currency,
        transactionId: tx.id
      });
    });
  },
  spendCrypto(data) {
    return mutate((draft) => {
      const requestedAmount = Number(data.amount || 0);
      const price = Number(data.price || 0);
      const reductions = reduceCrypto(draft, data.coinId, requestedAmount, data.exchange);
      const amount = reductions.reduce((sum, item) => sum + item.amount, 0);
      if (!amount) return;
      const meta = cryptoMetaFrom(draft, data, reductions);
      const valueUsd = amount * price;
      const cryptoTxId = uid("ctx");
      const category = draft.categories.find((item) => item.name === data.category) || draft.categories[draft.categories.length - 1];
      const tx = linkedTransaction(draft, cryptoTxId, {
        type: "expense",
        amount: valueUsd,
        currency: "USD",
        category: category.name,
        icon: category.icon,
        color: category.color,
        comment: data.comment || `Расход ${amount} ${meta.symbol || meta.coinId}`
      });
      draft.transactions.unshift(tx);
      draft.cryptoTransactions.unshift({
        id: cryptoTxId,
        type: "spend",
        date: tx.date,
        coinId: meta.coinId,
        symbol: meta.symbol,
        amount,
        price,
        valueUsd,
        reductions,
        transactionId: tx.id
      });
    });
  },
  transferCrypto(data) {
    return mutate((draft) => {
      const requestedAmount = Number(data.amount || 0);
      const reductions = reduceCrypto(draft, data.coinId, requestedAmount, data.fromExchange);
      const amount = reductions.reduce((sum, item) => sum + item.amount, 0);
      if (!amount) return;
      const meta = cryptoMetaFrom(draft, data, reductions);
      const avgBuy = amount ? reductions.reduce((sum, item) => sum + item.amount * item.avgBuy, 0) / amount : 0;
      const asset = normalizeCryptoAsset({
        coinId: meta.coinId,
        symbol: meta.symbol,
        name: meta.name,
        amount,
        avgBuy,
        exchange: data.toExchange,
        note: data.comment
      });
      const cryptoTxId = uid("ctx");
      draft.crypto.push(asset);
      draft.cryptoTransactions.unshift({
        id: cryptoTxId,
        type: "transfer",
        date: data.date || new Date().toISOString().slice(0, 10),
        coinId: asset.coinId,
        symbol: asset.symbol,
        amount,
        fromExchange: data.fromExchange,
        toExchange: data.toExchange,
        reductions,
        createdAssetId: asset.id
      });
    });
  },
  deleteCryptoOperation(id) {
    return mutate((draft) => {
      rollbackCryptoOperation(draft, id);
      draft.cryptoTransactions = draft.cryptoTransactions.filter((item) => item.id !== id);
      draft.transactions = draft.transactions.filter((item) => item.cryptoTxId !== id);
    });
  },
  swapCrypto(data) {
    return mutate((draft) => {
      const fromAmount = Number(data.fromAmount || 0);
      const toAmount = Number(data.toAmount || 0);
      const fromPrice = Number(data.fromPrice || 0);
      const toPrice = Number(data.toPrice || 0);

      const reductions = reduceCrypto(draft, data.fromCoinId, fromAmount, data.exchange);
      const actualFromAmount = reductions.reduce((sum, item) => sum + item.amount, 0);
      if (!actualFromAmount) return;

      const fromMeta = cryptoMetaFrom(draft, { coinId: data.fromCoinId, symbol: data.fromSymbol }, reductions);
      const avgBuy = actualFromAmount ? reductions.reduce((sum, item) => sum + item.amount * item.avgBuy, 0) / actualFromAmount : 0;
      const fromValueUsd = actualFromAmount * fromPrice;
      const toValueUsd = toAmount * toPrice;
      const pnl = toValueUsd - (actualFromAmount * avgBuy);

      const toAsset = normalizeCryptoAsset({
        coinId: data.toCoinId,
        symbol: data.toSymbol,
        name: data.toName || data.toSymbol,
        amount: toAmount,
        avgBuy: toPrice,
        exchange: data.exchange,
        note: data.comment
      });

      const cryptoTxId = uid("ctx");
      draft.crypto.push(toAsset);

      draft.cryptoTransactions.unshift({
        id: cryptoTxId,
        type: "swap",
        date: data.date || new Date().toISOString().slice(0, 10),
        fromCoinId: fromMeta.coinId,
        fromSymbol: fromMeta.symbol,
        fromAmount: actualFromAmount,
        fromPrice,
        toCoinId: toAsset.coinId,
        toSymbol: toAsset.symbol,
        toAmount,
        toPrice,
        fromValueUsd,
        toValueUsd,
        pnl,
        reductions,
        createdAssetId: toAsset.id,
        exchange: data.exchange
      });
    });
  },
  addGoal(data) {
    return mutate((draft) => draft.goals.push({ id: uid("g"), color: "#ffcc66", ...data, target: Number(data.target || 0), saved: Number(data.saved || 0) }));
  },
  importData(data) {
    return mutate((draft) => Object.assign(draft, data));
  }
};

function normalizeCoinId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCryptoAsset(data) {
  return {
    id: data.id || uid("c"),
    coinId: normalizeCoinId(data.coinId),
    symbol: String(data.symbol || "").trim().toUpperCase(),
    name: String(data.name || data.symbol || data.coinId || "").trim(),
    amount: Number(data.amount || 0),
    avgBuy: Number(data.avgBuy || 0),
    exchange: String(data.exchange || "").trim(),
    note: data.note || ""
  };
}

function linkedTransaction(draft, cryptoTxId, tx) {
  return {
    id: uid("tx"),
    date: tx.date || new Date().toISOString().slice(0, 10),
    cryptoTxId,
    ...tx
  };
}

function reduceCrypto(draft, coinId, amount, exchange = "") {
  let left = Number(amount || 0);
  const normalizedCoin = normalizeCoinId(coinId);
  const normalizedExchange = String(exchange || "").trim().toLowerCase();
  const candidates = draft.crypto.filter((asset) => {
    const sameCoin = normalizeCoinId(asset.coinId) === normalizedCoin || String(asset.symbol || "").toLowerCase() === normalizedCoin;
    const sameExchange = !normalizedExchange || String(asset.exchange || "").trim().toLowerCase() === normalizedExchange;
    return sameCoin && sameExchange && Number(asset.amount) > 0;
  });
  const reductions = [];

  candidates.forEach((asset) => {
    if (left <= 0) return;
    const take = Math.min(Number(asset.amount || 0), left);
    reductions.push({ asset: { ...asset }, assetId: asset.id, amount: take, avgBuy: Number(asset.avgBuy || 0), exchange: asset.exchange });
    asset.amount = Number(asset.amount || 0) - take;
    left -= take;
  });

  draft.crypto = draft.crypto.filter((asset) => Number(asset.amount || 0) > 0.000000001);
  return reductions;
}

function cryptoMetaFrom(draft, data, reductions = []) {
  const first = reductions[0]?.asset || draft.crypto.find((asset) => normalizeCoinId(asset.coinId) === normalizeCoinId(data.coinId)) || {};
  return {
    coinId: normalizeCoinId(data.coinId || first.coinId),
    symbol: String(data.symbol || first.symbol || "").trim().toUpperCase(),
    name: String(data.name || first.name || data.symbol || first.symbol || data.coinId || first.coinId || "").trim()
  };
}

function removeCreatedAsset(draft, assetId, amount) {
  const asset = draft.crypto.find((item) => item.id === assetId);
  if (!asset) return;
  asset.amount = Number(asset.amount || 0) - Number(amount || 0);
  draft.crypto = draft.crypto.filter((item) => Number(item.amount || 0) > 0.000000001);
}

function restoreReductions(draft, reductions = []) {
  reductions.forEach((item) => {
    const existing = draft.crypto.find((asset) => asset.id === item.assetId);
    if (existing) {
      existing.amount = Number(existing.amount || 0) + Number(item.amount || 0);
      return;
    }
    draft.crypto.push({ ...item.asset, amount: Number(item.amount || 0) });
  });
}

function rollbackCryptoOperation(draft, id) {
  const op = draft.cryptoTransactions.find((item) => item.id === id);
  if (!op) return;
  const wallet = draft.wallets.find((item) => item.id === op.walletId);

  if (op.type === "buy") {
    removeCreatedAsset(draft, op.asset.id, op.asset.amount);
    if (wallet && op.fiatAmount) wallet.balance += Number(op.fiatAmount || 0);
  }
  if (op.type === "sell") {
    restoreReductions(draft, op.reductions);
    if (wallet && op.fiatAmount) wallet.balance -= Number(op.fiatAmount || 0);
  }
  if (op.type === "spend") {
    restoreReductions(draft, op.reductions);
  }
  if (op.type === "transfer") {
    removeCreatedAsset(draft, op.createdAssetId, op.amount);
    restoreReductions(draft, op.reductions);
  }
  if (op.type === "swap") {
    removeCreatedAsset(draft, op.createdAssetId, op.toAmount);
    restoreReductions(draft, op.reductions);
  }
}
