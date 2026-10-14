// Entry of the S5 reference app. Write the app described in APP-SPEC.md.
import "./styles.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.querySelector("#app");
if (target) mount(App, { target });
