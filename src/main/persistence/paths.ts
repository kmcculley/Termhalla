import { app } from 'electron'

export const userDataDir = () => app.getPath('userData')
