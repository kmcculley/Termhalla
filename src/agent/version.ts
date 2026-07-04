/**
 * The agent's advertised version (REQ-004): EXACTLY this repo's package.json `version`,
 * inlined into the bundle at build time (the artifact is the unit of version-locking —
 * locked decision 2; the client provisions a matching build, F19).
 */
import { version } from '../../package.json'

export const AGENT_VERSION: string = version
