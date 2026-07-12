/// <reference types="vite/client" />

// Injected by vite's `define` (see vite.config.ts) - the UI's own build stamp.
declare const __APP_VERSION__: string;

declare module "*?worker&inline" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
