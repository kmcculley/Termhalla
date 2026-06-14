import { contextBridge } from 'electron'

// Expanded in Task 8. Present now so the renderer can assume it exists.
contextBridge.exposeInMainWorld('termhalla', {})
