import pc from 'picocolors'
import { resolve, join } from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { homedir } from 'node:os'
import * as p from '@clack/prompts'
import {
  header, footer, phase, blank,
  ok, fail, warn, note,
} from '../utils/print.ts'
import { runDoctorChecks, loadMetadata } from '../utils/validate.ts'

export async function cmdDeploy(args: string[]) {
  const workflowDir = resolve(args[0] ?? '.')
  const meta = loadMetadata(workflowDir)
  const workflowId = meta?.workflowId ?? 'workflow'

  header(`crehub deploy — ${workflowId}`)

  // ── [1/3]  Doctor checks ─────────────────────────────────────────────────────
  phase(1, 3, 'Pre-deploy checks')

  const checks = await runDoctorChecks(workflowDir, { checkOnChain: false })
  const failed = checks.filter(c => !c.passed)
  const passed = checks.filter(c => c.passed).length

  if (failed.length > 0) {
    for (const c of failed) fail(`${c.name}  —  ${c.message}`)
    blank()
    console.log(pc.red('  Fix the issues above before deploying.'))
    console.log(pc.dim(`  Run ${pc.white('crehub doctor')} for the full report.`))
    blank()
    process.exit(1)
  }

  ok(`${passed}/${checks.length} checks passed`)

  // ── [2/3]  Compile WASM ──────────────────────────────────────────────────────
  phase(2, 3, 'Compile WASM')

  note('bun run cre-compile  →  src/index.ts  →  src/tmp.wasm')
  blank()

  const compStart = Date.now()
  try {
    execSync('bun run cre-compile', { cwd: workflowDir, stdio: 'pipe' })
    ok(`WASM compiled  ${pc.dim(`(${((Date.now() - compStart) / 1000).toFixed(1)}s)`)}`)
  } catch (e: any) {
    fail('Compilation failed')
    const errText = e.stderr?.toString() ?? e.message
    console.log(pc.red(errText.split('\n').map((l: string) => `  ${l}`).join('\n')))
    blank()
    process.exit(1)
  }

  // ── Confirm ──────────────────────────────────────────────────────────────────
  blank()
  console.log(`  ${pc.bold('Deploy to CRE DON')}`)
  console.log(`  ${pc.dim('This submits your compiled WASM to the Chainlink Decentralised Oracle Network.')}`)
  console.log(`  ${pc.dim('Target: ')}production-settings`)
  blank()

  const confirmed = await p.confirm({ message: 'Proceed with deployment?' })
  if (!confirmed || p.isCancel(confirmed)) {
    p.cancel('Deployment cancelled.')
    process.exit(0)
  }

  // ── [3/3]  Deploy ────────────────────────────────────────────────────────────
  phase(3, 3, 'Deploying to CRE DON')
  note('cre workflow deploy  —  streaming output below')
  blank()

  await new Promise<void>((resolve, reject) => {
    const isWin  = process.platform === 'win32'
    const creBin = isWin
      ? join(homedir(), 'AppData', 'Local', 'Programs', 'cre')
      : join(homedir(), '.cre', 'bin')
    const pathSep = isWin ? ';' : ':'
    const env = { ...process.env, PATH: `${creBin}${pathSep}${process.env.PATH ?? ''}` }

    const creArgs = ['workflow', 'deploy', '.', '--target', 'production-settings']
    const [exe, spawnArgs] = isWin
      ? ['powershell.exe', ['-NonInteractive', '-NoProfile', '-Command', `cre ${creArgs.join(' ')}`]]
      : ['cre', creArgs]

    const proc = spawn(exe, spawnArgs, { cwd: workflowDir, stdio: 'inherit', env })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`cre deploy exited with code ${code}`))
    })
    proc.on('error', reject)
  }).catch((err) => {
    blank()
    fail(`Deployment failed: ${err.message}`)
    process.exit(1)
  })

  blank()
  footer()
  console.log(`  ${pc.green(pc.bold(`✓ ${workflowId} deployed to CRE DON`))}`)
  console.log(`  ${pc.dim('Next step:  ')}${pc.white('crehub list')}  ${pc.dim('— register on the CREHub marketplace')}`)
  blank()
}
