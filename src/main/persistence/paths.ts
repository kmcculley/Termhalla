import { app } from 'electron'
import { join } from 'node:path'

export const userDataDir = () => app.getPath('userData')
export const workspacesDir = () => join(userDataDir(), 'workspaces')
export const appStatePath = () => join(userDataDir(), 'app-state.json')
export const windowStatePath = () => join(userDataDir(), 'window-state.json')
