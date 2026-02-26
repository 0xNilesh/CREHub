import * as p from '@clack/prompts'
import pc from 'picocolors'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { getConfig } from '../utils/config.ts'
import { VALID_CATEGORIES } from '../utils/validate.ts'
import {
  SRC_INDEX_TS,
  CONFIG_JSON,
  METADATA_JSON,
  WORKFLOW_YAML,
  PROJECT_YAML,
  PACKAGE_JSON,
  TSCONFIG_JSON,
  CRE_COMPILE_TS,
} from '../template/index.ts'
import {
  header, footer, phase, blank,
  ok, fail, warn, note, logFile, logPkg, logKV, miniDiv,
} from '../utils/print.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toWorkflowId(name: string): string {
  const slug = name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
  return `wf_${slug}_01`
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// Parse "bun install" stdout → { packages: string[], count: number, time: string }
function parseBunInstall(output: string) {
  const packages = output
    .split('\n')
    .filter(l => l.trim().startsWith('+'))
    .map(l => l.trim().replace(/^\+ /, ''))
  const countMatch = output.match(/(\d+) packages? installed/)
  const count = countMatch ? parseInt(countMatch[1]) : packages.length
  const timeMatch = output.match(/\[(\d+\.?\d*(?:ms|s|m))\]/)
  const time = timeMatch ? timeMatch[1] : null
  return { packages, count, time }
}

// Parse "bun x cre-setup" stdout → { platform: string, javy: string, cached: boolean }
function parseCRESetup(output: string) {
  const platformMatch = output.match(/Detected platform: (\w+),\s*arch: (\w+)/)
  const platform = platformMatch ? `${platformMatch[1]}-${platformMatch[2]}` : 'unknown'
  const versionMatch = output.match(/\/v(\d+\.\d+\.\d+)\//)
  const javy = versionMatch ? `v${versionMatch[1]}` : 'unknown'
  const cached = output.toLowerCase().includes('cached')
  return { platform, javy, cached }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function cmdInit(args: string[]) {
  header('crehub init — scaffold a new workflow')

  p.intro(pc.bold(' ◈  CREHub Init '))

  const nameArg = args[0]

  // ── Prompts ─────────────────────────────────────────────────────────────────
  const answers = await p.group(
    {
      name: () => p.text({
        message: 'Workflow name',
        placeholder: 'my-signal-workflow',
        initialValue: nameArg ?? '',
        validate: (v) => {
          if (!v.trim()) return 'Name is required'
          if (existsSync(resolve(toSlug(v)))) return `Directory "${toSlug(v)}" already exists`
        },
      }),

      description: () => p.text({
        message: 'Short description (≤ 160 chars)',
        placeholder: 'Monitors X and returns Y on-chain.',
        validate: (v) => {
          if (!v.trim()) return 'Required'
          if (v.length > 160) return `Too long (${v.length} chars, max 160)`
        },
      }),

      detailedDescription: () => p.text({
        message: 'Detailed description',
        placeholder: 'A longer explanation of what the workflow does…',
        validate: (v) => (!v.trim() ? 'Required' : undefined),
      }),

      category: () => p.select({
        message: 'Category',
        options: VALID_CATEGORIES.map((c) => ({ value: c, label: c })),
      }),

      price: () => p.text({
        message: 'Price per invocation (USDC, e.g. 0.01)',
        placeholder: '0.01',
        initialValue: '0.01',
        validate: (v) => (isNaN(Number(v)) || Number(v) < 0 ? 'Enter a valid USDC amount' : undefined),
      }),

      addInputs: () => p.confirm({
        message: 'Add input fields now?',
        initialValue: true,
      }),
    },
    { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } },
  )

  // ── Input fields ─────────────────────────────────────────────────────────────
  const inputs: Array<{ name: string; type: string; description: string; required: boolean }> = []
  if (answers.addInputs) {
    let addMore = true
    while (addMore) {
      const field = await p.group({
        name:        () => p.text({ message: '  Field name', placeholder: 'symbol' }),
        type:        () => p.select({ message: '  Type', options: ['string','number','boolean','address'].map(v => ({ value: v, label: v })) }),
        description: () => p.text({ message: '  Description', placeholder: 'e.g. trading pair' }),
        required:    () => p.confirm({ message: '  Required?', initialValue: false }),
      }, { onCancel: () => {} })
      inputs.push(field as any)
      addMore = await p.confirm({ message: '  Add another input field?' }) as boolean
    }
  }

  if (p.isCancel(answers.name)) { p.cancel('Cancelled.'); process.exit(0) }

  // ── Derived values ───────────────────────────────────────────────────────────
  const name        = String(answers.name)
  const slug        = toSlug(name)
  const workflowId  = toWorkflowId(name)
  const priceWei    = String(Math.round(Number(answers.price) * 1_000_000))
  const { gatewayPublicKey } = getConfig()

  const outputs = [
    { name: 'result',    type: 'string', description: 'Workflow result.',              required: true },
    { name: 'timestamp', type: 'string', description: 'ISO-8601 execution timestamp.', required: true },
  ]

  const dir = resolve(slug)

  // ── [1/3]  Create project files ──────────────────────────────────────────────
  phase(1, 3, 'Creating project files')

  const inputSchemaLines = inputs.length
    ? inputs.map(f =>
        `\t${f.name}: z.${f.type === 'number' ? 'number' : 'string'}()${f.required ? '' : '.optional()'},`
      ).join('\n') + '\n'
    : '\t// e.g. symbol: z.string().default("BTC/USDT"),\n'

  const srcContent = SRC_INDEX_TS
    .replace('{{INPUT_SCHEMA}}', inputSchemaLines)
    .replace('{{OUTPUT_INTERFACE}}', '\t// Add your output fields here:\n')
    .replace(/\{\{WORKFLOW_ID\}\}/g, workflowId)

  const payloadObj = inputs.length
    ? Object.fromEntries(inputs.map(f => [f.name, `<${f.type}>`]))
    : { example: 'value' }

  mkdirSync(join(dir, 'src'),     { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'tests'),   { recursive: true })

  const filesToCreate: [string, string][] = [
    ['src/index.ts',               srcContent],
    ['metadata.json',              METADATA_JSON({ workflowId, creatorAddress: gatewayPublicKey, pricePerInvocation: priceWei, description: String(answers.description), detailedDescription: String(answers.detailedDescription), category: String(answers.category), inputs, outputs })],
    ['config.json',                CONFIG_JSON(gatewayPublicKey, workflowId)],
    ['workflow.yaml',              WORKFLOW_YAML(workflowId)],
    ['project.yaml',               PROJECT_YAML],
    ['package.json',               PACKAGE_JSON(slug, workflowId)],
    ['tsconfig.json',              TSCONFIG_JSON],
    ['scripts/cre-compile.ts',     CRE_COMPILE_TS],
    ['http_trigger_payload.json',  JSON.stringify(payloadObj)],
  ]

  for (const [relPath, content] of filesToCreate) {
    writeFileSync(join(dir, relPath), content)
    logFile(relPath)
  }

  blank()
  ok(`${filesToCreate.length} files created  ${pc.dim(`→ ./${slug}/`)}`)

  // ── [2/3]  Install dependencies ──────────────────────────────────────────────
  phase(2, 3, 'Installing dependencies')
  note(`bun install  (this may take a moment on first run)`)
  blank()

  const installStart = Date.now()
  let installOk = false
  let installOut = ''

  try {
    installOut = execSync('bun install', { cwd: dir, stdio: 'pipe' }).toString()
    installOk  = true
  } catch (e: any) {
    installOut = e.stdout?.toString() ?? ''
  }

  if (installOk) {
    const { packages, count, time } = parseBunInstall(installOut)
    // Show the explicitly added packages (lines starting with +)
    for (const pkg of packages) logPkg(pkg)
    if (packages.length > 0) miniDiv()
    ok(`${count} packages installed${time ? `  ${pc.dim(`(${time})`)}` : ''}`)
  } else {
    warn('bun install failed — run manually inside the project folder')
    note(`cd ${slug} && bun install`)
  }

  // ── [3/3]  Set up CRE SDK (Javy) ─────────────────────────────────────────────
  phase(3, 3, 'Setting up CRE SDK  (Javy plugin)')
  note('bun x cre-setup  —  installs the platform-native WASM compiler')
  blank()

  let setupOk = false
  let setupOut = ''

  try {
    setupOut = execSync('bun x cre-setup', { cwd: dir, stdio: 'pipe' }).toString()
    setupOk  = true
  } catch (e: any) {
    setupOut = e.stdout?.toString() ?? ''
  }

  if (setupOk) {
    const { platform, javy, cached } = parseCRESetup(setupOut)
    logKV('Platform', platform)
    logKV('Javy',     `${javy}  ${pc.dim(cached ? '(cached)' : '(downloaded)')}`)
    blank()
    ok('CRE SDK ready')
  } else {
    warn('cre-setup failed — run manually: bun x cre-setup')
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  blank()
  footer()

  p.outro(pc.bold(pc.green(`✓ ${workflowId} scaffolded → ./${slug}/`)))

  console.log('')
  console.log(pc.bold('  Next steps:'))
  console.log(`  ${pc.dim('1.')}  ${pc.cyan(`cd ${slug}`)}`)
  console.log(`  ${pc.dim('2.')}  Edit ${pc.white('src/index.ts')}  — implement your workflow logic`)
  console.log(`  ${pc.dim('3.')}  ${pc.white('crehub test')}          — compile, simulate & validate`)
  console.log(`  ${pc.dim('4.')}  ${pc.white('crehub doctor')}        — full pre-deploy compatibility check`)
  console.log(`  ${pc.dim('5.')}  ${pc.white('crehub deploy')}        — deploy to Chainlink CRE DON`)
  console.log(`  ${pc.dim('6.')}  ${pc.white('crehub list')}          — register on CREHub marketplace`)
  console.log('')
}
