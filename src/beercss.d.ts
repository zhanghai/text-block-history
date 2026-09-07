export {};

declare global {
  interface Window {
    // Beer CSS's global dialog/theme controller, attached by beer.min.js.
    ui?: (selector?: string, options?: unknown) => unknown;
  }
}
