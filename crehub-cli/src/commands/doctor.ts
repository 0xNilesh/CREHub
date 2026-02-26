import pc from 'picocolors'
import { resolve } from 'node:path'
import { runDoctorChecks } from '../utils/validate.ts'
import { header, footer, section, checkOk, checkFail, blank } from '../utils/print.ts'

// ─── Check groups ─────────────────────────────────────────────────────────────

const GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: 'Metadata',
    names: [
      'metadata.json exists',
      'workflowId format',
      'description',
      'detailedDescription',
      'category',
      'pricePerInvocation',
      'inputs/outputs schema',
    ],
  },
  {
    label: 'Configuration',
    names: [
      'config.json exists',
      'gatewayPublicKey',
      'no placeholder config values',
    ],
  },
  {
    label: 'Code & Build',
    names: [
      'src/index.ts exists',
      'workflow.yaml exists',
      'WASM compiled',
    ],
  },
  {
    label: 'On-chain',
    names: [
      'not yet on-chain',
    ],
  },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function cmdDoctor(args: string[]) {
  const workflowDir = resolve(args[0] ?? '.')

  let workflowId = workflowDir.split(/[\\/]/).pop() ?? 'workflow'
  try {
    const { readFileSync } = await import('node:fs')
    const meta = JSON.parse(readFileSync(`${workflowDir}/metadata.json`, 'utf8'))
    workflowId = meta.workflowId ?? workflowId
  } catch { /* use directory name */ }

  header(`crehub doctor — ${workflowId}`)

  const checks = await runDoctorChecks(workflowDir, { checkOnChain: true })
  const byName = new Map(checks.map(c => [c.name, c]))

  let totalPassed = 0
  let totalFailed = 0

  // Print checks grouped by section
  for (const group of GROUPS) {
    section(group.label)
    for (const name of group.names) {
      const c = byName.get(name)
      if (!c) continue
      if (c.passed) { checkOk(c.name, c.message);   totalPassed++ }
      else          { checkFail(c.name, c.message);  totalFailed++ }
    }
  }

  // Any checks not in a group (future-proofing)
  const ungrouped = checks.filter(c => !GROUPS.some(g => g.names.includes(c.name)))
  if (ungrouped.length > 0) {
    section('Other')
    for (const c of ungrouped) {
      if (c.passed) { checkOk(c.name, c.message);   totalPassed++ }
      else          { checkFail(c.name, c.message);  totalFailed++ }
    }
  }

  blank()
  footer()

  if (totalFailed === 0) {
    console.log(`  ${pc.green(pc.bold('✓ All checks passed'))} ${pc.dim(`(${totalPassed}/${checks.length})`)}`)
    console.log(`  ${pc.dim('Ready to deploy:  ')}${pc.white('crehub deploy')}`)
    console.log(`  ${pc.dim('Ready to list:    ')}${pc.white('crehub list')}`)
  } else {
    console.log(`  ${pc.red(pc.bold(`✗ ${totalFailed} issue${totalFailed > 1 ? 's' : ''} found`))} ${pc.dim(`(${totalPassed}/${checks.length} passed)`)}`)
    console.log(`  ${pc.dim('Fix the issues above, then run ')}${pc.white('crehub doctor')}${pc.dim(' again.')}`)
  }

  blank()
  process.exit(totalFailed > 0 ? 1 : 0)
}
