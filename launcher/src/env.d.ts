/// <reference types="vite/client" />
declare module '*.js?raw' { const s: string; export default s }
declare module '*.wasm?inline' { const s: string; export default s }
