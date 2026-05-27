import { getRecord, setRecord } from "./db.js";

const FALLBACK_RATES = { USD_UAH: 40.2, EUR_UAH: 43.6, EUR_USD: 1.08, updatedAt: null, offline: true };
const COINS = ["bitcoin", "ethereum", "solana", "tether", "binancecoin", "ripple", "dogecoin", "toncoin"];
const REQUEST_TIMEOUT = 6000;

function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  return fetch(url, { signal: controller.signal })
    .then((response) => response.json())
    .finally(() => clearTimeout(timer));
}

export async function getRates() {
  const cached = await getRecord("rates", FALLBACK_RATES);
  const isFresh = cached?.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < 1000 * 60 * 60 * 4;
  if (isFresh) return cached;

  try {
    // Используем exchangerate-api.com для получения курсов с UAH
    const [usdData, eurData] = await Promise.all([
      fetchJson("https://api.exchangerate-api.com/v4/latest/USD"),
      fetchJson("https://api.exchangerate-api.com/v4/latest/EUR")
    ]);

    const rates = {
      USD_UAH: usdData.rates.UAH || cached.USD_UAH || FALLBACK_RATES.USD_UAH,
      EUR_UAH: eurData.rates.UAH || cached.EUR_UAH || FALLBACK_RATES.EUR_UAH,
      EUR_USD: eurData.rates.USD || cached.EUR_USD || FALLBACK_RATES.EUR_USD,
      updatedAt: new Date().toISOString(),
      offline: false
    };
    await setRecord("rates", rates);
    return rates;
  } catch {
    return { ...cached, offline: true };
  }
}

export async function getCryptoMarket(ids = COINS) {
  const cached = await getRecord("cryptoMarket", {});
  const isFresh = cached?.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < 1000 * 60 * 10;
  if (isFresh) return cached;

  try {
    const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("order", "market_cap_desc");
    url.searchParams.set("sparkline", "true");
    url.searchParams.set("price_change_percentage", "24h,7d");
    const data = await fetchJson(url);
    const market = {
      updatedAt: new Date().toISOString(),
      offline: false,
      coins: Object.fromEntries(data.map((coin) => [coin.id, coin]))
    };
    await setRecord("cryptoMarket", market);
    return market;
  } catch {
    return cached?.coins ? { ...cached, offline: true } : fallbackMarket();
  }
}

function fallbackMarket() {
  const prices = {
    bitcoin: ["Bitcoin", "BTC", 68000, 2.4],
    ethereum: ["Ethereum", "ETH", 3550, 1.1],
    solana: ["Solana", "SOL", 172, -3.2],
    tether: ["Tether", "USDT", 1, 0],
    binancecoin: ["BNB", "BNB", 610, 0.8]
  };
  return {
    updatedAt: null,
    offline: true,
    coins: Object.fromEntries(
      Object.entries(prices).map(([id, [name, symbol, current_price, price_change_percentage_24h]]) => [
        id,
        { id, name, symbol: symbol.toLowerCase(), current_price, price_change_percentage_24h, sparkline_in_7d: { price: Array.from({ length: 32 }, (_, i) => current_price * (0.95 + Math.sin(i / 4) * 0.03 + i / 800)) } }
      ])
    )
  };
}

export function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const toUah = from === "UAH" ? amount : from === "USD" ? amount * rates.USD_UAH : amount * rates.EUR_UAH;
  if (to === "UAH") return toUah;
  if (to === "USD") return toUah / rates.USD_UAH;
  return toUah / rates.EUR_UAH;
}
