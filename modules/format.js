export const CURRENCIES = {
  UAH: { symbol: "₴", locale: "uk-UA" },
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" }
};

export const currencyList = Object.keys(CURRENCIES);

export function money(value, currency = "USD", compact = false) {
  const options = {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 0 : 2
  };
  return new Intl.NumberFormat(CURRENCIES[currency]?.locale || "ru-RU", options).format(Number(value) || 0);
}

export function number(value, digits = 2) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

export function percent(value) {
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${number(value, 2)}%`;
}

export function dateLabel(date, mode = "short") {
  const options = mode === "long"
    ? { day: "numeric", month: "long", weekday: "long" }
    : { day: "2-digit", month: "short" };
  return new Intl.DateTimeFormat("ru-RU", options).format(new Date(date));
}

export function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function daysBetween(start, end) {
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
}
