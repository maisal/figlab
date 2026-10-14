// Entry of the S5 reference app in Solid.
import "./styles.css";
import { render } from "solid-js/web";
import { App } from "./App";

const container = document.querySelector("#app");
if (container) render(() => <App />, container);
