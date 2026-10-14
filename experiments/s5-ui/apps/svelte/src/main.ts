// Entry of the S5 reference app in Svelte 5.
import "./styles.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.querySelector("#app");
if (target) mount(App, { target });
