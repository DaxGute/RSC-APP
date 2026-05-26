/** Lets the RN bridge process touches and paints between heavy JS work. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
