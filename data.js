import { uid } from "./format.js";

export const categories = [
  ["Еда", "utensils", "#68fbd0"],
  ["Транспорт", "tram-front", "#66a6ff"],
  ["Крипта", "bitcoin", "#ffcc66"],
  ["Подписки", "badge-check", "#b28cff"],
  ["Развлечения", "party-popper", "#ff7da8"],
  ["Инвестиции", "trending-up", "#5ee087"],
  ["Учеба", "book-open", "#7bdff2"],
  ["Одежда", "shirt", "#f6a6ff"],
  ["Подарки", "gift", "#ff9b6a"],
  ["Спорт", "dumbbell", "#a3e635"],
  ["Путешествия", "plane", "#38bdf8"],
  ["Другое", "sparkles", "#d1d5db"]
].map(([name, icon, color]) => ({ id: name.toLowerCase(), name, icon, color }));

export function demoData() {
  const wallets = [
    { id: "w_uah_card", name: "Карта UAH", currency: "UAH", type: "Карта", balance: 0, color: "#68fbd0" },
    { id: "w_usd_cash", name: "Наличные USD", currency: "USD", type: "Наличные", balance: 0, color: "#66a6ff" },
    { id: "w_eur_save", name: "Сбережения EUR", currency: "EUR", type: "Сбережения", balance: 0, color: "#b28cff" }
  ];

  return {
    meta: { createdAt: new Date().toISOString(), seeded: true, seedProfile: "zero-v1" },
    settings: { baseCurrency: "USD", theme: "dark" },
    wallets,
    transactions: [],
    exchanges: [],
    crypto: [],
    goals: [],
    categories
  };
}
