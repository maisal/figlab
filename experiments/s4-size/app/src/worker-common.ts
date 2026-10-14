// Helpers for the two workers.

export const now = () => performance.timeOrigin + performance.now();

export function resources() {
  return performance.getEntriesByType("resource").map((r) => {
    const e = r as PerformanceResourceTiming;
    return {
      name: e.name.split("/").pop(),
      start: Math.round(e.startTime + performance.timeOrigin),
      end: Math.round(e.responseEnd + performance.timeOrigin),
      transfer: e.transferSize,
      body: e.encodedBodySize,
    };
  });
}
