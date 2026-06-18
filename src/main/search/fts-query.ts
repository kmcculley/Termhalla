/** Turn a user's free-text query into a safe FTS5 MATCH expression. Each whitespace-delimited
 *  token is wrapped in double quotes (with embedded quotes stripped), so FTS5 special characters
 *  ( ) * : ^ - " become literal and can never produce a MATCH syntax error. Tokens are implicitly
 *  ANDed. Blank input returns '' (the caller treats '' as "no results"). */
export function toMatchExpr(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  return tokens.map(t => `"${t.replace(/"/g, '')}"`).filter(t => t !== '""').join(' ')
}
