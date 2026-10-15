// Compute worker stand-in: instantiates the compute module and answers commands.

import { now, resources } from "./worker-common";
import init, * as compute from "../../pkg/app/compute/m_compute.js";

const scriptStart = now();
try {
  await init();
  self.onmessage = (e: MessageEvent) => {
    const value = compute.run(e.data.src);
    self.postMessage({ type: "answer", value, at: now() });
  };
  self.postMessage({ type: "ready", scriptStart, at: now(), resources: resources() });
} catch (e) {
  self.postMessage({ type: "error", message: String(e) });
}
