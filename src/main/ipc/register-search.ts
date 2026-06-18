import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { SearchService } from '../search/search-service'
import type { Indexer } from '../search/indexer'
import type { Disposer } from './types'

/** Search IPC: query/stats/clear (invoke, request→response) + setMuted (send). Returns a disposer
 *  that flushes pending segments (indexer.dispose) and closes the DB on shutdown. */
export function registerSearch(deps: { searchService: SearchService; indexer: Indexer }): Disposer {
  const { searchService, indexer } = deps
  ipcMain.handle(CH.searchQuery, (_e, q: string) => searchService.query(q))
  ipcMain.handle(CH.searchStats, () => searchService.stats())
  ipcMain.handle(CH.searchClear, () => { searchService.clear(); return searchService.stats() })
  ipcMain.on(CH.searchSetMuted, (_e, paneId: string, muted: boolean) => indexer.setMuted(paneId, muted))
  return () => { indexer.dispose(); searchService.close() }
}
