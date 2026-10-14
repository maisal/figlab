// Entry of the S5 reference app. Write the app described in APP-SPEC.md.
import "./styles.css";
import { render } from "preact";
import { App } from "./App";

const container = document.querySelector("#app");
if (container) render(<App />, container);
