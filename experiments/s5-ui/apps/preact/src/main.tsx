// Entry of the S5 reference app in Preact.
import "./styles.css";
import { render } from "preact";
import { App } from "./App";

const container = document.querySelector("#app");
if (container) render(<App />, container);
