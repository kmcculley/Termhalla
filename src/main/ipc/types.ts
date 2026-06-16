/** A teardown-guarded `win.webContents.send` (see registerHandlers' safeSend). */
export type Send = (channel: string, ...args: unknown[]) => void

/** A registrar's teardown callback, aggregated into the single `win.on('closed')` handler. */
export type Disposer = () => void
