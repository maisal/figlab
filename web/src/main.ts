import { statusMessage } from "./status";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  app.textContent = statusMessage();
}
