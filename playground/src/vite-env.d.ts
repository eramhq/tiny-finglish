/// <reference types="vite/client" />

/** Vite's `?raw` suffix imports a file's contents as a string. */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
