#!/usr/bin/env bun
import pc from 'picocolors'
import { intro, select, isCancel, cancel, outro } from '@clack/prompts'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Version ──────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dir, '../package.json'), 'utf8'))

// ─── Brand ────────────────────────────────────────────────────────────────────

const BRAND   = pc.bold(pc.cyan('◈  CREHub'))
const VERSION = pc.dim(`v${version}`)
const W       = 56  // inner box width

function box(lines: string[]) {
  const top    = '  ╭' + '─'.repeat(W) + '╮'
  const bottom = '  ╰' + '─'.repeat(W) + '╯'
  const pad    = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visLen(s)))
  console.log(top)
  for (const line of lines) {
    console.log('  │ ' + pad(line, W - 2) + ' │')
  }
  console.log(bottom)
}

// Length of string without ANSI escape codes
function visLen(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

function printBanner() {
  console.log('')
  box([
    '',
    `${BRAND}  ${pc.white('CLI')}  ${VERSION}`,
    pc.dim('Chainlink CRE Workflow Developer Toolkit'),
    '',
    pc.dim('Build · Test · Deploy · List on-chain'),
    '',
  ])
  console.log('')
}

function printVersion() {
  console.log('')
  box([
    `${BRAND}  ${VERSION}`,
    pc.dim('Chainlink CRE Workflow Developer Toolkit'),
  ])
  console.log('')
}

// ─── Static help ──────────────────────────────────────────────────────────────

function printHelp() {
  printBanner()

  console.log(pc.bold('  USAGE'))
  console.log(`    ${pc.cyan('crehub')} ${pc.white('<command>')} ${pc.dim('[options]')}`)
  console.log(`    ${pc.cyan('crehub')} ${pc.white('<command>')} ${pc.dim('--help')}`)
  console.log('')

  console.log(pc.bold('  COMMANDS'))
  const cmds: [string, string, string][] = [
    ['init',   '[name]',               'Scaffold a new CREHub-compatible workflow'],
    ['doctor', '[dir]',                '14-point pre-deploy compatibility check'],
    ['test',   '[dir]',                'Local CRE simulation + output validation'],
    ['deploy', '[dir]',                'Compile WASM + deploy to CRE DON'],
    ['list',   '[dir]',                'Register workflow on CREHub marketplace'],
    ['config', '<set|get|show|clear>', 'Manage global CLI configuration'],
  ]
  for (const [cmd, args, desc] of cmds) {
    console.log(
      `    ${pc.cyan(cmd.padEnd(8))}  ${pc.white(args.padEnd(22))}  ${pc.dim(desc)}`
    )
  }
  console.log('')

  console.log(pc.bold('  FLAGS'))
  const flags: [string, string, string][] = [
    ['test',   '--payload <file|json>', 'Override the HTTP trigger payload'],
    ['test',   '--recompile',           'Force WASM recompilation before test'],
    ['test',   '--verbose',             'Print raw simulation output'],
    ['*',      '--help',                'Show help for any command'],
    ['*',      '--version, -v',         'Print CLI version'],
  ]
  for (const [cmd, flag, desc] of flags) {
    const label = cmd === '*' ? 'crehub'.padEnd(14) : `crehub ${cmd}`.padEnd(14)
    console.log(
      `    ${pc.dim(label)}  ${pc.white(flag.padEnd(22))}  ${pc.dim(desc)}`
    )
  }
  console.log('')

  console.log(pc.bold('  EXAMPLES'))
  const examples: [string, string][] = [
    ['crehub init my-price-feed',          'Scaffold a new workflow'],
    ['crehub doctor .',                    'Validate the current directory'],
    ['crehub test . --recompile',          'Force recompile, then simulate'],
    ['crehub list .',                      'Register & list on marketplace'],
    ['crehub config set privateKey <key>', 'Store your wallet private key'],
    ['crehub test --help',                 'Show detailed test options'],
  ]
  for (const [ex, desc] of examples) {
    console.log(`    ${pc.cyan('$')} ${pc.white(ex.padEnd(42))}  ${pc.dim(desc)}`)
  }
  console.log('')

  console.log(pc.bold('  LINKS'))
  console.log(`    ${pc.dim('Docs     ')}  ${pc.white('https://github.com/0xNilesh/CREHub')}`)
  console.log(`    ${pc.dim('Config   ')}  ${pc.white('~/.crehub/config.json')}`)
  console.log(`    ${pc.dim('Issues   ')}  ${pc.white('https://github.com/0xNilesh/CREHub/issues')}`)
  console.log('')
}

// ─── Per-command help ─────────────────────────────────────────────────────────

const COMMAND_HELP: Record<string, () => void> = {
  init: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub init')) + pc.dim(' [name]'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Interactively scaffold a new CREHub-compatible workflow.'))
    console.log(pc.dim('  Runs bun install + bun x cre-setup automatically.'))
    console.log('')
    console.log(pc.bold('  STEPS'))
    console.log(`    ${pc.dim('1.')} ${pc.white('Name, description, category, price')}`)
    console.log(`    ${pc.dim('2.')} ${pc.white('Define input fields (interactive)')}`)
    console.log(`    ${pc.dim('3.')} ${pc.white('Scaffold project files')}`)
    console.log(`    ${pc.dim('4.')} ${pc.white('bun install + cre-setup automatically')}`)
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub init`)
    console.log(`    ${pc.cyan('$')} crehub init my-price-feed`)
    console.log('')
  },

  doctor: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub doctor')) + pc.dim(' [dir]'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Run 14-point CREHub compatibility check before deploying.'))
    console.log('')
    console.log(pc.bold('  CHECKS'))
    const checks = [
      'metadata.json exists',
      'workflowId format (wf_name_NN)',
      'description ≤ 160 chars',
      'detailedDescription present',
      'category is valid',
      'pricePerInvocation numeric',
      'inputs/outputs schema defined',
      'config.json exists',
      'gatewayPublicKey set',
      'no placeholder config values',
      'src/index.ts exists',
      'workflow.yaml exists',
      'WASM compiled (src/tmp.wasm)',
      'not yet registered on-chain',
    ]
    checks.forEach((c, i) => console.log(`    ${pc.dim(`${(i+1).toString().padStart(2)}.`)} ${pc.white(c)}`))
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub doctor .`)
    console.log(`    ${pc.cyan('$')} crehub doctor ~/my-workflow`)
    console.log('')
  },

  test: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub test')) + pc.dim(' [dir] [flags]'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Compile → simulate via CRE DON → validate output schema.'))
    console.log('')
    console.log(pc.bold('  FLAGS'))
    const flags: [string, string][] = [
      ['--payload <file|json>', 'Override trigger payload (file path or inline JSON)'],
      ['--recompile',           'Force WASM recompilation even if WASM is up-to-date'],
      ['--verbose',             'Print the full raw simulation output'],
    ]
    for (const [f, d] of flags) {
      console.log(`    ${pc.white(f.padEnd(24))}  ${pc.dim(d)}`)
    }
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub test .`)
    console.log(`    ${pc.cyan('$')} crehub test . --recompile`)
    console.log(`    ${pc.cyan('$')} crehub test . --payload '{"n":10}'`)
    console.log(`    ${pc.cyan('$')} crehub test . --payload payload.json --verbose`)
    console.log('')
  },

  deploy: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub deploy')) + pc.dim(' [dir]'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Compile WASM + deploy workflow to the CRE DON.'))
    console.log(pc.dim('  Runs doctor checks first. Deploy requires a CRE account.'))
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub deploy .`)
    console.log(`    ${pc.cyan('$')} crehub deploy ~/my-workflow`)
    console.log('')
  },

  list: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub list')) + pc.dim(' [dir]'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Register a deployed workflow on the CREHub marketplace.'))
    console.log(pc.dim('  Requires a wallet private key in ~/.crehub/config.json.'))
    console.log('')
    console.log(pc.bold('  REQUIREMENTS'))
    console.log(`    ${pc.dim('·')} ${pc.white('privateKey')} set via ${pc.cyan('crehub config set privateKey <key>')}`)
    console.log(`    ${pc.dim('·')} Workflow already deployed to CRE DON`)
    console.log(`    ${pc.dim('·')} All doctor checks passing`)
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub list .`)
    console.log(`    ${pc.cyan('$')} crehub list ~/my-workflow`)
    console.log('')
  },

  config: () => {
    console.log('')
    console.log(pc.bold(pc.cyan('  crehub config')) + pc.dim(' <subcommand>'))
    console.log(pc.dim('  ─────────────────────────────────────────────'))
    console.log(pc.dim('  Manage global CLI config stored at ~/.crehub/config.json'))
    console.log('')
    console.log(pc.bold('  SUBCOMMANDS'))
    const subs: [string, string][] = [
      ['set <key> <value>', 'Store a config value'],
      ['get <key>',         'Print a config value'],
      ['show',              'Print all stored config'],
      ['clear',             'Erase all stored config'],
    ]
    for (const [sub, desc] of subs) {
      console.log(`    ${pc.white(sub.padEnd(22))}  ${pc.dim(desc)}`)
    }
    console.log('')
    console.log(pc.bold('  KEYS'))
    const keys: [string, string][] = [
      ['privateKey',       'Wallet private key for on-chain listing'],
      ['gatewayPublicKey', 'CREHub gateway public key (default pre-set)'],
      ['registryAddress',  'WorkflowRegistry contract address (default pre-set)'],
      ['rpcUrl',           'Ethereum Sepolia RPC URL (default pre-set)'],
    ]
    for (const [k, d] of keys) {
      console.log(`    ${pc.cyan(k.padEnd(20))}  ${pc.dim(d)}`)
    }
    console.log('')
    console.log(pc.bold('  EXAMPLES'))
    console.log(`    ${pc.cyan('$')} crehub config set privateKey 0xabc123...`)
    console.log(`    ${pc.cyan('$')} crehub config show`)
    console.log(`    ${pc.cyan('$')} crehub config get rpcUrl`)
    console.log('')
  },
}

// ─── Interactive menu (no-args mode) ──────────────────────────────────────────

async function interactiveMenu() {
  printBanner()

  intro(pc.bold(pc.cyan(' ◈ CREHub ') + pc.white(' Developer CLI ')))

  const action = await select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'init',
        label: `${pc.cyan('init')}    ${pc.dim('─')}  Scaffold a new CREHub-compatible workflow`,
      },
      {
        value: 'doctor',
        label: `${pc.cyan('doctor')}  ${pc.dim('─')}  14-point pre-deploy compatibility check`,
      },
      {
        value: 'test',
        label: `${pc.cyan('test')}    ${pc.dim('─')}  Simulate workflow locally + validate output`,
      },
      {
        value: 'deploy',
        label: `${pc.cyan('deploy')}  ${pc.dim('─')}  Compile WASM + deploy to CRE DON`,
      },
      {
        value: 'list',
        label: `${pc.cyan('list')}    ${pc.dim('─')}  Register workflow on CREHub marketplace`,
      },
      {
        value: 'config',
        label: `${pc.cyan('config')}  ${pc.dim('─')}  Manage global CLI configuration`,
      },
      {
        value: 'help',
        label: `${pc.dim('help')}    ${pc.dim('─')}  Show full help & documentation`,
      },
    ],
  })

  if (isCancel(action)) {
    cancel('Cancelled.')
    process.exit(0)
  }

  if (action === 'help') {
    outro('Showing help...')
    printHelp()
    return
  }

  outro(`Running: ${pc.bold(pc.cyan('crehub ' + action))} .`)
  console.log('')

  await runCommand(String(action), ['.'])
}

// ─── Command runner ───────────────────────────────────────────────────────────

async function runCommand(command: string, args: string[]) {
  switch (command) {
    case 'init': {
      const { cmdInit } = await import('./commands/init.ts')
      await cmdInit(args)
      break
    }
    case 'doctor': {
      const { cmdDoctor } = await import('./commands/doctor.ts')
      await cmdDoctor(args)
      break
    }
    case 'test': {
      const { cmdTest } = await import('./commands/test.ts')
      await cmdTest(args)
      break
    }
    case 'deploy': {
      const { cmdDeploy } = await import('./commands/deploy.ts')
      await cmdDeploy(args)
      break
    }
    case 'list': {
      const { cmdList } = await import('./commands/list.ts')
      await cmdList(args)
      break
    }
    case 'config': {
      const { cmdConfig } = await import('./commands/config.ts')
      cmdConfig(args)
      break
    }
    default: {
      console.log(pc.red(`\n  Unknown command: ${pc.bold(command)}`))
      console.log(pc.dim(`  Run ${pc.white('crehub --help')} to see available commands.\n`))
      process.exit(1)
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

// --version / -v
if (argv[0] === '--version' || argv[0] === '-v') {
  printVersion()
  process.exit(0)
}

// --help / help (static, pipe-friendly)
if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
  printHelp()
  process.exit(0)
}

// No args → interactive menu
if (argv.length === 0) {
  await interactiveMenu()
  process.exit(0)
}

const [command, ...args] = argv

// Per-command --help: crehub test --help
if (args.includes('--help') || args.includes('-h')) {
  const helpFn = COMMAND_HELP[command]
  if (helpFn) {
    helpFn()
  } else {
    console.log(pc.red(`\n  No help available for: ${command}`))
    console.log(pc.dim(`  Run ${pc.white('crehub --help')} to see all commands.\n`))
    process.exit(1)
  }
  process.exit(0)
}

await runCommand(command, args)
