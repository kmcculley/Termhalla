const MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', toml: 'ini', ini: 'ini',
  bat: 'bat', cmd: 'bat', dockerfile: 'dockerfile', lua: 'lua'
}

/** Monaco language id for a file path, by extension. 'plaintext' if unknown. */
export function languageForPath(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path)
  const ext = m ? m[1].toLowerCase() : ''
  return MAP[ext] ?? 'plaintext'
}
