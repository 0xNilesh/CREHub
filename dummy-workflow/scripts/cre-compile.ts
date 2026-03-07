#!/usr/bin/env bun
import { execSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const [, wasmOut = 'tmp.wasm'] = process.argv.slice(2)

let workflowSrcDir = 'src'
try {
	const yaml = readFileSync('workflow.yaml', 'utf8')
	const match = yaml.match(/workflow-path\s*:\s*["']?\.\/([^/\s"']+)\//)
	if (match) workflowSrcDir = match[1]
} catch { /* fall back to 'src' */ }

const srcFile = join(workflowSrcDir, 'index.ts')
const wasmPath = join(workflowSrcDir, basename(wasmOut))

if (existsSync(wasmPath) && existsSync(srcFile)) {
	const wasmMtime = statSync(wasmPath).mtimeMs
	const srcMtime  = statSync(srcFile).mtimeMs
	if (wasmMtime > srcMtime) {
		console.log('[cre-compile] WASM cache hit — skipping recompilation')
		process.exit(0)
	}
}

console.log(`[cre-compile] Compiling ${srcFile} → ${wasmPath}`)
execSync(`bun x cre-compile "${srcFile}" "${wasmPath}"`, { stdio: 'inherit' })
