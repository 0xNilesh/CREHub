import pc from 'picocolors'

// ─── Symbols ──────────────────────────────────────────────────────────────────

export const sym = {
  ok:    pc.green('✓'),
  fail:  pc.red('✗'),
  warn:  pc.yellow('⚠'),
  info:  pc.cyan('ℹ'),
  arrow: pc.dim('→'),
  dot:   pc.dim('·'),
  pipe:  pc.dim('│'),
  plus:  pc.dim('+'),
}

// ─── Command frame ────────────────────────────────────────────────────────────

export const header = (title: string) => {
  console.log('')
  console.log(`  ${pc.bgCyan(pc.black(' CREHub '))}  ${pc.bold(pc.white(title))}`)
  console.log(`  ${pc.dim('─'.repeat(58))}`)
}

export const footer = () => {
  console.log(`  ${pc.dim('─'.repeat(58))}`)
}

export const blank = () => console.log('')

// ─── Phase headers ────────────────────────────────────────────────────────────
// Renders:
//
//   [1/4]  Title

export const phase = (n: number, total: number, title: string) => {
  console.log('')
  console.log(`  ${pc.dim(`[${n}/${total}]`)}  ${pc.bold(pc.white(title))}`)
}

// ─── Content lines (indented under a phase) ───────────────────────────────────
// 9 spaces keeps content aligned with title text after "[n/t]  "

const I = '         '  // 9-space indent

export const ok      = (msg: string) => console.log(`${I}${sym.ok}   ${msg}`)
export const fail    = (msg: string) => console.log(`${I}${sym.fail}  ${pc.red(msg)}`)
export const warn    = (msg: string) => console.log(`${I}${sym.warn}  ${pc.yellow(msg)}`)
export const note    = (msg: string) => console.log(`${I}${sym.dot}   ${pc.dim(msg)}`)
export const logLine = (msg: string) => console.log(`${I}${pc.dim('│')}  ${pc.cyan(msg)}`)
export const logKV   = (k: string, v: string, vColor = pc.white) =>
  console.log(`${I}${pc.dim(k.padEnd(14))}  ${vColor(v)}`)

// ─── List items (files / packages) ───────────────────────────────────────────

export const logFile = (name: string) => console.log(`${I}${sym.plus}   ${pc.dim(name)}`)
export const logPkg  = (name: string) => console.log(`${I}${sym.plus}   ${pc.dim(name)}`)

// ─── Dividers ─────────────────────────────────────────────────────────────────

export const divider    = ()              => console.log(`  ${pc.dim('─'.repeat(58))}`)
export const miniDiv    = ()              => console.log(`${I}${pc.dim('─'.repeat(44))}`)

// ─── Section label (groups of checks inside doctor) ──────────────────────────
// Renders:
//   ─── Metadata ─────────────────────────

export const section = (title: string) => {
  const pad = Math.max(0, 40 - title.length)
  console.log('')
  console.log(`  ${pc.dim('───')}  ${pc.bold(title)}  ${pc.dim('─'.repeat(pad))}`)
}

// ─── Check rows (two-column, used in doctor) ─────────────────────────────────

export const checkOk   = (name: string, detail: string) =>
  console.log(`  ${sym.ok}   ${pc.white(name.padEnd(28))}  ${pc.dim(detail)}`)

export const checkFail = (name: string, detail: string) =>
  console.log(`  ${sym.fail}  ${pc.white(name.padEnd(28))}  ${pc.red(detail)}`)

// ─── Legacy compat (step is still used in test / list) ───────────────────────

export const step = (msg: string) => console.log(`  ${sym.arrow} ${pc.dim(msg)}`)
export const info = (msg: string) => console.log(`${I}${sym.info}  ${pc.cyan(msg)}`)
