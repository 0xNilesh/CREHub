/**
 * Static map of workflowId → absolute path to the workflow directory.
 *
 * Add an entry here for any workflow that is registered on-chain but
 * runs locally via `cre workflow simulate` (i.e. not deployed to a DON).
 *
 * The gateway uses this map to resolve workflowDir when triggering a
 * simulate run. It takes precedence over any value stored in MongoDB
 * or the WORKFLOW_DIR environment variable default.
 */
import path from 'node:path'

// Two levels up from gateway/src → monorepo root
const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

export const WORKFLOW_DIRS: Record<string, string> = {
	wf_hello_world_01: path.join(ROOT, 'workflows', 'hello-world'),
}
