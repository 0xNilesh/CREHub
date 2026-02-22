/**
 * CRE workflow simulate runner.
 *
 * Writes the trigger input as http_trigger_payload.json (the CRE CLI convention
 * for HTTP-triggered workflows), then shells out to `cre workflow simulate`.
 *
 * Output parsing: The CRE CLI prints workflow logs to stdout. We capture all
 * output and attempt to parse the last JSON object as the workflow result.
 * On non-zero exit code the error is captured from stderr.
 *
 * Shell strategy: On Windows we invoke powershell.exe explicitly (not cmd.exe).
 * cmd.exe causes `cre workflow simulate` to hang indefinitely even with
 * --non-interactive, while the identical command completes in ~4s under
 * PowerShell. spawnSync with explicit args avoids any shell-escaping issues.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SimulateResult } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SIMULATE_TIMEOUT_MS = 300_000 // 5 min (cre-compile can be slow first run)
const HTTP_PAYLOAD_FILENAME = 'http_trigger_payload.json'

// ─── Output parser ────────────────────────────────────────────────────────────

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

export const parseSimulateOutput = (stdout: string): SimulateResult => {
	const rawLines = stdout.split('\n')
	const logLines = rawLines.map(stripAnsi).filter(Boolean)

	// Strategy 1: look for "Workflow Simulation Result:" marker (CRE CLI pretty-prints
	// a multi-line JSON block after this line, terminated by a blank line).
	const markerIdx = rawLines.findIndex(l => l.includes('Workflow Simulation Result:'))
	if (markerIdx !== -1) {
		const jsonLines: string[] = []
		for (let i = markerIdx + 1; i < rawLines.length; i++) {
			const trimmed = stripAnsi(rawLines[i]).trim()
			if (!trimmed) break // blank line signals end of JSON block
			jsonLines.push(trimmed)
		}
		if (jsonLines.length > 0) {
			try {
				const parsed = JSON.parse(jsonLines.join('\n'))
				return { success: true, output: parsed, logs: logLines }
			} catch {
				// malformed — fall through to Strategy 2
			}
		}
	}

	// Strategy 2: walk lines in reverse looking for the last parseable single-line JSON.
	for (let i = logLines.length - 1; i >= 0; i--) {
		const line = logLines[i].trim()
		if (line.startsWith('{') || line.startsWith('[')) {
			try {
				const parsed = JSON.parse(line)
				return { success: true, output: parsed, logs: logLines }
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
		logs: logLines,
	}
}

// ─── runSimulate ──────────────────────────────────────────────────────────────

export const runSimulate = async (workflowDir: string, input: unknown): Promise<SimulateResult> => {
	// Ensure workflow directory exists (e.g. for tests using /tmp paths)
	mkdirSync(workflowDir, { recursive: true })

	// Write input payload to the workflow directory (CRE CLI convention)
	const payloadPath = join(workflowDir, HTTP_PAYLOAD_FILENAME)
	writeFileSync(payloadPath, JSON.stringify(input), 'utf8')

	const target = process.env.CRE_TARGET ?? 'local-simulation'
	// Ensure CRE CLI install dir is on PATH (Windows: AppData\Local\Programs\cre)
	const isWin = process.platform === 'win32'
	const creBin = isWin
		? join(homedir(), 'AppData', 'Local', 'Programs', 'cre')
		: join(homedir(), '.cre', 'bin')
	const pathSep = isWin ? ';' : ':'
	const env = {
		...process.env,
		PATH: `${creBin}${pathSep}${process.env.PATH ?? ''}`,
	}

	// Build the cre CLI args (same on all platforms)
	const creArgs = [
		'workflow', 'simulate', '.',
		'-R', '.',
		'--target', target,
		'--non-interactive',
		'--trigger-index', '0',
		'--http-payload', `./${HTTP_PAYLOAD_FILENAME}`,
	]

	// On Windows: invoke via powershell.exe (cmd.exe hangs indefinitely).
	// Use async spawn so we can stream output and see where a hang occurs.
	const [exe, args] = isWin
		? ['powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', `cre ${creArgs.join(' ')}`]]
		: ['cre', creArgs]

	console.log(`[simulate] cwd=${workflowDir}`)
	console.log(`[simulate] cmd=${exe} ${args.join(' ')}`)

	return new Promise<SimulateResult>((resolve) => {
		const proc = spawn(exe, args, {
			cwd: workflowDir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env,
		})

		let stdout = ''
		let stderr = ''

		proc.stdout.on('data', (chunk: Buffer) => {
			const text = chunk.toString()
			process.stdout.write(`[simulate:out] ${text}`)
			stdout += text
		})
		proc.stderr.on('data', (chunk: Buffer) => {
			const text = chunk.toString()
			process.stderr.write(`[simulate:err] ${text}`)
			stderr += text
		})

		const timer = setTimeout(() => {
			console.error(`[simulate] TIMEOUT after ${SIMULATE_TIMEOUT_MS / 1000}s`)
			console.error(`[simulate] stdout so far:\n${stdout}`)
			console.error(`[simulate] stderr so far:\n${stderr}`)
			proc.kill('SIGKILL')
			resolve({
				success: false,
				output: null,
				error: `simulate timed out after ${SIMULATE_TIMEOUT_MS / 1000}s`,
				logs: [...stdout.split('\n'), ...stderr.split('\n')].filter(Boolean),
			})
		}, SIMULATE_TIMEOUT_MS)

		proc.on('error', (err) => {
			clearTimeout(timer)
			resolve({
				success: false,
				output: null,
				error: err.message,
				logs: [...stdout.split('\n'), ...stderr.split('\n')].filter(Boolean),
			})
		})

		proc.on('close', (code) => {
			clearTimeout(timer)
			console.log(`[simulate] exited code=${code}`)
			if (code !== 0) {
				resolve({
					success: false,
					output: null,
					error: stderr || `simulate exited with code ${code}`,
					logs: [...stdout.split('\n'), ...stderr.split('\n')].filter(Boolean),
				})
			} else {
				resolve(parseSimulateOutput(stdout))
			}
		})
	})
}
