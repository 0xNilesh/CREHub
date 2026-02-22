/**
 * CRE workflow simulate runner.
 *
 * Writes the trigger input as http_trigger_payload.json (the CRE CLI convention
 * for HTTP-triggered workflows), then shells out to `cre workflow simulate`.
 *
 * Output parsing: The CRE CLI prints workflow logs to stdout. We capture all
 * output and attempt to parse the last JSON object as the workflow result.
 * On non-zero exit code the error is captured from stderr.
 */
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { SimulateResult } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SIMULATE_TIMEOUT_MS = 60_000 // 60 s
const HTTP_PAYLOAD_FILENAME = 'http_trigger_payload.json'

// ─── Output parser ────────────────────────────────────────────────────────────

export const parseSimulateOutput = (stdout: string): SimulateResult => {
	const lines = stdout.split('\n').filter(Boolean)

	// Walk lines in reverse looking for the last parseable JSON object/array.
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim()
		if (line.startsWith('{') || line.startsWith('[')) {
			try {
				const parsed = JSON.parse(line)
				return { success: true, output: parsed, logs: lines }
			} catch {
				// not JSON — keep searching
			}
		}
	}

	// No JSON found — treat as failure
	return {
		success: false,
		output: null,
		error: 'No JSON output found in simulate stdout',
		logs: lines,
	}
}

// ─── runSimulate ──────────────────────────────────────────────────────────────

export const runSimulate = async (workflowDir: string, input: unknown): Promise<SimulateResult> => {
	// Ensure workflow directory exists (e.g. for tests using /tmp paths)
	mkdirSync(workflowDir, { recursive: true })

	// Write input payload to the workflow directory (CRE CLI convention)
	const payloadPath = join(workflowDir, HTTP_PAYLOAD_FILENAME)
	writeFileSync(payloadPath, JSON.stringify(input), 'utf8')

	let stdout = ''
	let stderr = ''

	const target = process.env.CRE_TARGET ?? 'local-simulation'
	const cmd = [
		'cre workflow simulate',
		workflowDir,
		`--target ${target}`,
		`--http-payload ./${HTTP_PAYLOAD_FILENAME}`,
	].join(' ')

	try {
		const combined = execSync(cmd, {
			cwd: workflowDir,
			timeout: SIMULATE_TIMEOUT_MS,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
		})
		stdout = combined
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
			const spawnErr = err as { stdout: string; stderr: string; message: string }
			stdout = spawnErr.stdout ?? ''
			stderr = spawnErr.stderr ?? ''
			return {
				success: false,
				output: null,
				error: stderr || spawnErr.message,
				logs: [...stdout.split('\n'), ...stderr.split('\n')].filter(Boolean),
			}
		}
		throw err
	}

	return parseSimulateOutput(stdout)
}
