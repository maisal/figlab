// Language service worker stand-in: instantiates the module and checks text.

import { now, resources } from "./worker-common";
import init, * as lang from "../../pkg/app/lang/m_lang.js";

const scriptStart = now();
try {
  await init();
  self.onmessage = (e: MessageEvent) => {
    const value = lang.check(e.data.src) + lang.complete("pl") + lang.hover("plot").length;
    self.postMessage({ type: "answer", value, at: now() });
  };
  self.postMessage({ type: "ready", scriptStart, at: now(), resources: resources() });
} catch (e) {
  self.postMessage({ type: "error", message: String(e) });
}
