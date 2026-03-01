import pc from 'picocolors'
import { resolve, join } from 'node:path'
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { homedir } from 'node:os'
import {
  header, footer, phase, blank, divider,
  ok, fail, warn, note, logLine, logKV, miniDiv,
} from '../utils/print.ts'
import { loadMetadata, runDoctorChecks, validateOutputSchema } from '../utils/validate.ts'

// ─── Parse flags ──────────────────────────────────────────────────────────────

function parseArgs(args: string[]) {
  const opts = { workflowDir: '.', payload: null as string | null, recompile: false, verbose: false, broadcast: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--payload' && args[i + 1]) { opts.payload = args[++i]; continue }
    if (args[i] === '--recompile') { opts.recompile = true; continue }
    if (args[i] === '--verbose')   { opts.verbose   = true; continue }
    if (args[i] === '--broadcast') { opts.broadcast  = true; continue }
    if (!args[i].startsWith('--')) opts.workflowDir = args[i]
  }
  return opts
}

// ─── Simulate runner ──────────────────────────────────────────────────────────

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function parseSimulateOutput(stdout: string): {
  success: boolean
  output: Record<string, unknown> | null
  error?: string
  logs: string[]
} {
  const rawLines = stdout.split('\n')
  const logLines = rawLines.map(stripAnsi).filter(Boolean)

  const markerIdx = rawLines.findIndex(l => l.includes('Workflow Simulation Result:'))
  if (markerIdx !== -1) {
    const jsonLines: string[] = []
    for (let i = markerIdx + 1; i < rawLines.length; i++) {
      const trimmed = stripAnsi(rawLines[i]).trim()
      if (!trimmed) break
      jsonLines.push(trimmed)
    }
    if (jsonLines.length > 0) {
      try {
        return { success: true, output: JSON.parse(jsonLines.join('\n')), logs: logLines }
      } catch { /* fall through */ }
    }
  }

  for (let i = logLines.length - 1; i >= 0; i--) {
    const line = logLines[i].trim()
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        return { success: true, output: JSON.parse(line), logs: logLines }
      } catch { /* keep searching */ }
    }
  }

  const errLine = logLines.find(l => l.toLowerCase().includes('error') || l.includes('failed'))
  return { success: false, output: null, error: errLine ?? 'No JSON output found', logs: logLines }
}

function runSimulate(
  workflowDir: string,
  payloadPath: string,
  verbose: boolean,
  broadcast: boolean = false,
): Promise<ReturnType<typeof parseSimulateOutput> & { durationMs: number }> {
  return new Promise((resolve) => {
    const start  = Date.now()
    const isWin  = process.platform === 'win32'
    const creBin = isWin
      ? join(homedir(), 'AppData', 'Local', 'Programs', 'cre')
      : join(homedir(), '.cre', 'bin')
    const pathSep = isWin ? ';' : ':'
    const env = { ...process.env, PATH: `${creBin}${pathSep}${process.env.PATH ?? ''}` }

    const creArgs = [
      'workflow', 'simulate', '.',
      '-R', '.',
      '--target', 'local-simulation',
      '--non-interactive',
      '--trigger-index', '0',
      '--http-payload', payloadPath,
      ...(broadcast ? ['--broadcast'] : []),
    ]

    const [exe, args] = isWin
      ? ['powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', `cre ${creArgs.join(' ')}`]]
      : ['cre', creArgs]

    const proc = spawn(exe, args, { cwd: workflowDir, stdio: ['pipe', 'pipe', 'pipe'], env })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      if (verbose) {
        process.stdout.write(pc.dim(text))
      } else {
        for (const line of text.split('\n')) {
          const clean = stripAnsi(line)
          if (clean.includes('[USER LOG]')) {
            const msg = clean.replace(/.*\[USER LOG\]\s*/, '').trim()
            if (msg) logLine(msg)
          }
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (verbose) process.stderr.write(pc.dim(chunk.toString()))
    })

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve({
        success: false, output: null,
        error: 'Simulation timed out after 300s',
        logs: [], durationMs: Date.now() - start,
      })
    }, 300_000)

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ success: false, output: null, error: err.message, logs: [], durationMs: Date.now() - start })
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      const parsed = code !== 0
        ? { success: false, output: null, error: stderr || `exited with code ${code}`, logs: stdout.split('\n').filter(Boolean) }
        : parseSimulateOutput(stdout)
      resolve({ ...parsed, durationMs: Date.now() - start })
    })
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function cmdTest(args: string[]) {
  const opts = parseArgs(args)
  const workflowDir = resolve(opts.workflowDir)

  const meta = loadMetadata(workflowDir)
  const workflowId = meta?.workflowId ?? workflowDir.split(/[\\/]/).pop() ?? 'workflow'

  header(`crehub test — ${workflowId}`)

  // ── [1/4]  Pre-flight checks ─────────────────────────────────────────────────
  phase(1, 4, 'Pre-flight checks')

  const checks = await runDoctorChecks(workflowDir, { checkOnChain: false })
  const critical = ['metadata.json exists', 'src/index.ts exists', 'config.json exists', 'no placeholder config values']
  const critFailed = checks.filter(c => critical.includes(c.name) && !c.passed)

  const passed  = checks.filter(c => c.passed).length
  const total   = checks.length

  if (critFailed.length > 0) {
    for (const c of critFailed) fail(`${c.name}  —  ${c.message}`)
    blank()
    console.log(pc.red('  Fix the issues above, then run crehub test again.'))
    console.log(pc.dim(`  Full check:  ${pc.white('crehub doctor')}`))
    blank()
    process.exit(1)
  }

  ok(`${passed}/${total} checks passed`)
  if (passed < total) {
    const nonCrit = checks.filter(c => !c.passed)
    for (const c of nonCrit) warn(`${c.name}  —  ${c.message}`)
  }

  // ── [2/4]  Compile WASM ──────────────────────────────────────────────────────
  phase(2, 4, 'Compile WASM')

  const wasmPath = join(workflowDir, 'src', 'tmp.wasm')
  const srcPath  = join(workflowDir, 'src', 'index.ts')
  const needsCompile = opts.recompile
    || !existsSync(wasmPath)
    || (existsSync(srcPath) && statSync(wasmPath).mtimeMs < statSync(srcPath).mtimeMs)

  if (!needsCompile) {
    const wasmStat = statSync(wasmPath)
    const age = Math.round((Date.now() - wasmStat.mtimeMs) / 1000)
    ok(`WASM is up to date  ${pc.dim(`(last built ${age}s ago)`)}`)
    note(`Use --recompile to force rebuild`)
  } else {
    const reason = opts.recompile ? '--recompile flag' : !existsSync(wasmPath) ? 'WASM missing' : 'src/index.ts changed'
    note(`Reason: ${reason}`)
    note(`bun run cre-compile  →  src/index.ts  →  src/tmp.wasm`)
    blank()

    const compStart = Date.now()
    let compileOut = ''
    let compileFailed = false

    try {
      compileOut = execSync('bun run cre-compile', { cwd: workflowDir, stdio: 'pipe' }).toString()
    } catch (e: any) {
      compileFailed = true
      const errText = e.stderr?.toString() ?? e.stdout?.toString() ?? e.message
      fail('Compilation failed')
      blank()
      console.log(pc.red(errText.split('\n').map((l: string) => `  ${l}`).join('\n')))
      blank()
      process.exit(1)
    }

    // Show key lines from compile output
    for (const line of compileOut.split('\n')) {
      const clean = stripAnsi(line).trim()
      if (!clean) continue
      if (clean.includes('Bundled') || clean.includes('module')) note(clean)
      if (clean.includes('✅') || clean.includes('Compiled') || clean.includes('Built')) {
        const short = clean.replace(/[✅]/g, '').replace(/Workflow built:.*/, '').trim()
        if (short) note(short)
      }
    }

    const elapsed = ((Date.now() - compStart) / 1000).toFixed(1)
    blank()
    ok(`Compiled  ${pc.dim(`(${elapsed}s)`)}`)
  }

  // ── [3/4]  Simulation ────────────────────────────────────────────────────────
  phase(3, 4, 'Simulation')

  // Resolve payload
  let payloadFile = join(workflowDir, 'http_trigger_payload.json')
  let payloadData: Record<string, unknown> = {}

  if (opts.payload) {
    if (opts.payload.startsWith('{')) {
      payloadData = JSON.parse(opts.payload)
      writeFileSync(payloadFile, JSON.stringify(payloadData))
    } else {
      payloadFile = resolve(opts.payload)
      payloadData = JSON.parse(readFileSync(payloadFile, 'utf8'))
    }
  } else if (existsSync(payloadFile)) {
    payloadData = JSON.parse(readFileSync(payloadFile, 'utf8'))
  }

  logKV('Payload', JSON.stringify(payloadData))
  blank()
  note('cre workflow simulate  (streaming runtime logs below)')
  miniDiv()

  if (opts.broadcast) note('--broadcast enabled: on-chain write will execute')
  const result = await runSimulate(workflowDir, payloadFile, opts.verbose, opts.broadcast)

  miniDiv()
  blank()

  if (!result.success) {
    fail(`Simulation failed`)
    if (result.error) console.log(`  ${pc.red(result.error)}`)
    blank()
    if (!opts.verbose) note('Run with --verbose for the full simulation output')
    blank()
    process.exit(1)
  }

  // Pretty-print output JSON
  note('Output:')
  const outputLines = JSON.stringify(result.output, null, 2).split('\n')
  for (const line of outputLines) console.log(`             ${pc.dim(line)}`)

  // ── [4/4]  Schema validation ─────────────────────────────────────────────────
  phase(4, 4, 'Schema validation')

  const dur = (result.durationMs / 1000).toFixed(1)

  if (!meta?.outputs?.length) {
    ok(`Simulation passed  ${pc.dim(`(no schema defined · ${dur}s)`)}`)
    blank()
    footer()
    console.log(`  ${pc.dim('Ready to list:   ')}${pc.white('crehub list')}`)
    blank()
    return
  }

  const validations = validateOutputSchema(
    result.output as Record<string, unknown>,
    meta.outputs,
  )

  let fieldsFailed = 0
  for (const v of validations) {
    const tag  = pc.dim(v.expected.padEnd(8))
    const val  = pc.dim(String(v.actual).slice(0, 40))
    if (v.passed)  ok(`${pc.white(v.field.padEnd(16))}  ${tag}  ${val}`)
    else         { fail(`${pc.white(v.field.padEnd(16))}  ${tag}  ${pc.red(String(v.actual))}`); fieldsFailed++ }
  }

  blank()
  footer()

  const fieldTotal = validations.length
  if (fieldsFailed === 0) {
    console.log(`  ${pc.green(pc.bold('✓ Simulation passed'))}  ${pc.dim(`(${fieldTotal}/${fieldTotal} fields valid · ${dur}s)`)}`)
    console.log(`  ${pc.dim('Next step:  ')}${pc.white('crehub list')}  ${pc.dim('— register on the marketplace')}`)
  } else {
    console.log(`  ${pc.red(pc.bold('✗ Schema mismatch'))}  ${pc.dim(`(${fieldTotal - fieldsFailed}/${fieldTotal} fields valid · ${dur}s)`)}`)
    console.log(`  ${pc.dim('Fix the output fields in src/index.ts and re-run.')}`)
  }

  blank()
}
