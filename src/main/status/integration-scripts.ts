import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PS_FILE = 'termhalla.ps1'
export const SH_FILE = 'termhalla.sh'

// PowerShell: wrap the existing prompt to emit D (last exit) + A (prompt);
// a PSReadLine Enter handler emits C (command start). Degrades to A/D if absent.
export const POWERSHELL_INTEGRATION = String.raw`
$global:__thOrigPrompt = $function:prompt
function global:prompt {
  $code = $LASTEXITCODE; if ($null -eq $code) { $code = 0 }
  $e = [char]27; $b = [char]7
  [Console]::Write("$e]133;D;$code$b")
  [Console]::Write("$e]133;A$b")
  [Console]::Write("$e]9;9;$($pwd.ProviderPath)$b")
  if ($global:__thOrigPrompt) { & $global:__thOrigPrompt } else { "PS " + (Get-Location) + "> " }
}
try {
  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
    $e = [char]27; $b = [char]7
    [Console]::Write("$e]133;C$b")
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
  }
} catch { }
`

// bash: source user's rc, then emit D+A in PROMPT_COMMAND and C in a DEBUG trap.
// Note: \x24 is $ — avoids JS template-literal parsing of ${...} by esbuild.
export const BASH_INTEGRATION = (
  '[ -f ~/.bashrc ] && source ~/.bashrc\n' +
  '__th_prompt() { local c=$?; printf \'\\033]133;D;%s\\007\\033]133;A\\007\\033]7;file://%s%s\\007\' "$c" "$HOSTNAME" "$PWD"; }\n' +
  'case "$PROMPT_COMMAND" in\n' +
  '  *__th_prompt*) ;;\n' +
  '  *) PROMPT_COMMAND="__th_prompt\x24{PROMPT_COMMAND:+; \x24PROMPT_COMMAND}" ;;\n' +
  'esac\n' +
  '__th_preexec() {\n' +
  '  [ -n "$COMP_LINE" ] && return\n' +
  '  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return\n' +
  '  printf \'\\033]133;C\\007\'\n' +
  '}\n' +
  'trap \'__th_preexec\' DEBUG\n'
)

/** Write both integration scripts into `dir`, creating it if needed. Idempotent. */
export function writeIntegrationScripts(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PS_FILE), POWERSHELL_INTEGRATION, 'utf8')
  writeFileSync(join(dir, SH_FILE), BASH_INTEGRATION, 'utf8')
}
