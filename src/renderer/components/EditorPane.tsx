import { UNTITLED } from '@shared/editor-draft'
import { api } from '../api'
import type { EditorConfig } from '@shared/types'
import { useEditorTabs } from '../editor/use-editor-tabs'
import { EditorTabStrip } from './EditorTabStrip'

export function EditorPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: EditorConfig }) {
  const {
    hostRef, order, active, activeTab, getTab, setActiveModel,
    openTab, closeTab, clearUntitled, saveUntitledAs, reloadActive, dismissExternalChange
  } = useEditorTabs(paneId, wsId, config)

  const untitledContent = getTab(UNTITLED)?.model.getValue() ?? ''

  return (
    <div data-testid={`editor-${paneId}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <EditorTabStrip
        order={order} active={active} untitledContent={untitledContent} getTab={getTab}
        onSelect={setActiveModel} onClose={closeTab}
        onSaveUntitledAs={() => void saveUntitledAs()} onClearUntitled={clearUntitled}
        onOpenFile={async () => { const p = await api.openFile(); if (p) void openTab(p) }}
      />
      {activeTab?.tooLarge && <div data-testid="editor-toolarge" style={{ color: '#bbb', padding: 8 }}>File too large to open.</div>}
      {activeTab?.externalChanged && (
        <div data-testid="editor-reloadbar" style={{ background: '#5a4a00', color: '#fff', padding: '2px 8px', display: 'flex', gap: 8 }}>
          <span>Changed on disk.</span>
          <button data-testid="editor-reload" onClick={() => void reloadActive()}>Reload</button>
          <button data-testid="editor-keepmine" onClick={dismissExternalChange}>Keep mine</button>
        </div>
      )}
      <div ref={hostRef} style={{ flex: 1, display: activeTab?.tooLarge ? 'none' : 'block' }} />
    </div>
  )
}
