import { initState, subscribe } from "./state.js";
import { bootUi, render, toast } from "./ui.js";

async function main() {
  await initState();
  subscribe(render);
  bootUi();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => toast("Offline cache недоступен", "warn"));
  }
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre class="fatal-error">Не удалось запустить приложение: ${error.message}</pre>`;
});
