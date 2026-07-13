/// <reference types="vite/client" />

// Injected by vite's `define` (see vite.config.ts) - the UI's own build stamp.
declare const __APP_VERSION__: string;

// Injected by vite's `define` - which device this bundle IS. Used to pick the
// device's surface.ts out of a glob, since a static import cannot name a file
// that some devices do not have.
declare const __DEVICE__: string;

declare module "*?worker&inline" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
