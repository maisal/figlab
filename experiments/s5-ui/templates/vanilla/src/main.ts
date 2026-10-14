// Entry of the S5 reference app. Write the app described in APP-SPEC.md.
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  const root = document.createElement("div");
  root.className = "app";
  app.append(root);
}
