#!/usr/bin/env bun
/**
 * CRE compile hook — called by the CRE CLI as:
 *   bun run cre-compile <intermediateJs> <wasmOutput>
 *
 * Delegates to the CRE SDK's official `cre-compile` binary which correctly:
 *   1. Wraps the workflow with wrapWorkflowCode() — registers triggers with the CRE runtime.
 *   2. Compiles TypeScript → JS (--target browser, Javy-compatible).
 *   3. Compiles JS → WASM via Javy.
 *
 * Compilation is cached: if the WASM is newer than the TypeScript source, the
 * recompilation is skipped so repeated trigger calls are fast.
 */
import { execSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

// Args from CRE CLI: <intermediate-js-name> <wasm-name>
const [, wasmOut = 'tmp.wasm'] = process.argv.slice(2)

// ── Derive workflow source directory from workflow.yaml ────────────────────
let workflowSrcDir = 'src'
try {
	const yaml = readFileSync('workflow.yaml', 'utf8')
	const match = yaml.match(/workflow-path\s*:\s*["']?\.\/([^/\s"']+)\//)
	if (match) workflowSrcDir = match[1]
} catch {
	// fall back to 'src'
}

const srcFile = join(workflowSrcDir, 'index.ts')
const wasmPath = join(workflowSrcDir, basename(wasmOut))

// ── Cache check: skip recompilation if WASM is newer than the TS source ───
if (existsSync(wasmPath) && existsSync(srcFile)) {
	const wasmMtime = statSync(wasmPath).mtimeMs
	const srcMtime = statSync(srcFile).mtimeMs
	if (wasmMtime > srcMtime) {
		console.log('[cre-compile] WASM cache hit — skipping recompilation')
		process.exit(0)
	}
}

// ── Full (re)compilation via CRE SDK's cre-compile binary ─────────────────
console.log(`[cre-compile] Compiling ${srcFile} → ${wasmPath}`)
execSync(`bun x cre-compile "${srcFile}" "${wasmPath}"`, { stdio: 'inherit' })
