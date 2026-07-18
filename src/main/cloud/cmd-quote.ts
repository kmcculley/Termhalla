/** Whitespace + cmd.exe metacharacters: any of these in a raw argument is re-interpreted by the
 *  shell that `shell: true` puts between us and the CLI (probe.ts uses it so Windows .cmd shims
 *  like az.cmd execute). Whitespace splits the arg; the rest are cmd operators / expansion. */
const NEEDS_QUOTES = /[\s"&|<>^%()!;,=]/

/**
 * Quote one argument for a `shell: true` spawn (cmd.exe on Windows). Node's execFile joins args
 * with spaces UNQUOTED under shell:true, so an AWS profile name containing spaces (legal in
 * `~/.aws/config`, passed verbatim to `--profile`) silently split into multiple args — the probe
 * exited non-zero and the provider misreported as logged-out — and metacharacters (`&`, `|`, …)
 * would be interpreted by the shell. Plain args pass through untouched, so every existing probe
 * command line stays byte-identical. Embedded double quotes are doubled (`""`) — the quoted-string
 * escape both cmd.exe and the MSVCRT argv parser accept. (`%VAR%` expansion cannot be fully
 * escaped on a cmd command line; quoting still prevents word-splitting and operator injection.)
 */
export function quoteCmdArg(arg: string): string {
  if (arg !== '' && !NEEDS_QUOTES.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}
