/// <reference types="vite/client" />
declare module '*.txt?raw' {
  const s: string;
  export default s;
}
interface ImportMetaEnv {
  readonly VITE_DEMO?: string;
  readonly VITE_LIVE?: string;
}
