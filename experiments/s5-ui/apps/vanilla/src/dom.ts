// A small helper for building the DOM and keeping state without a framework.

type Child = Node | string;

interface ElementOptions {
  className?: string;
  attrs?: Record<string, string>;
  props?: Record<string, unknown>;
  on?: Record<string, (event: Event) => void>;
}

/** Create an element with attributes, properties, event listeners, and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  for (const [name, value] of Object.entries(options.attrs ?? {})) el.setAttribute(name, value);
  Object.assign(el, options.props ?? {});
  for (const [type, listener] of Object.entries(options.on ?? {})) el.addEventListener(type, listener);
  el.append(...children);
  return el;
}

export interface Store<T> {
  get(): T;
  /** Replace the state with the result of `update`. Listeners run at once. */
  update(update: (state: T) => T): void;
  /** Call `listener` after every change. Returns a function that removes it. */
  subscribe(listener: (state: T, previous: T) => void): () => void;
}

/** A store for immutable state. */
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T, previous: T) => void>();
  return {
    get: () => state,
    update(update) {
      const previous = state;
      state = update(state);
      if (state !== previous) for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
