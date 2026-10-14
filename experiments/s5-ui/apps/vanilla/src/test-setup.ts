// Stubs for browser APIs that jsdom does not have (unit tests only).
class StubResizeObserver implements ResizeObserver {
  observe(): void {
    // jsdom has no layout, so sizes never change.
  }
  unobserve(): void {
    // nothing to stop
  }
  disconnect(): void {
    // nothing to stop
  }
}
globalThis.ResizeObserver = StubResizeObserver;
