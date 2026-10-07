export {}
declare global {
  interface Window {
    vt: {
      invoke: (name: string, ...args: any[]) => Promise<any>
      pathFor: (f: File) => string
      on: (cb: (ch: string, ...a: any[]) => void) => () => void
    }
  }
}
