import pc from 'picocolors'
import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import {
  header, footer, phase, blank,
  ok, fail, warn, note, logKV,
} from '../utils/print.ts'
import { runDoctorChecks, loadMetadata } from '../utils/validate.ts'
import { workflowExists, registerWorkflow, waitForTx } from '../utils/contract.ts'
import { getConfig, setConfigKey } from '../utils/config.ts'

export async function cmdList(args: string[]) {
  const dirIdx = args.indexOf('--dir')
  const workflowDir = dirIdx !== -1 ? resolve(args[dirIdx + 1]) : resolve('.')

  const meta = loadMetadata(workflowDir)
  if (!meta) {
    console.log(pc.red('\n  metadata.json not found. Run from inside a workflow directory.\n'))
    process.exit(1)
  }

  const workflowId = args.find(a => !a.startsWith('-') && a !== args[dirIdx + 1]) ?? meta.workflowId

  header(`crehub list — ${workflowId}`)

  // ── [1/4]  Doctor checks ─────────────────────────────────────────────────────
  phase(1, 4, 'Pre-list checks')

  const checks = await runDoctorChecks(workflowDir, { checkOnChain: false })
  const failed = checks.filter(c => !c.passed)

  if (failed.length > 0) {
    for (const c of failed) fail(`${c.name}  —  ${c.message}`)
    blank()
    console.log(pc.red('  Fix the issues above before listing.'))
    console.log(pc.dim(`  Run ${pc.white('crehub doctor')} for the full report.`))
    blank()
    process.exit(1)
  }

  ok(`${checks.filter(c => c.passed).length}/${checks.length} checks passed`)

  // ── [2/4]  On-chain check ────────────────────────────────────────────────────
  phase(2, 4, 'On-chain status')

  note(`Querying WorkflowRegistry on Ethereum Sepolia...`)

  const alreadyExists = await workflowExists(workflowId)
  if (alreadyExists) {
    blank()
    fail(`${workflowId} is already registered on-chain.`)
    note('Each workflow ID can only be registered once.')
    blank()
    process.exit(1)
  }

  ok(`${workflowId} is not yet registered — ready to list`)

  // ── [3/4]  Confirm listing details ───────────────────────────────────────────
  phase(3, 4, 'Listing summary')

  logKV('workflowId',    meta.workflowId)
  logKV('description',   meta.description.slice(0, 55) + (meta.description.length > 55 ? '…' : ''))
  logKV('category',      meta.category)
  logKV('price',         `${(Number(meta.pricePerInvocation) / 1_000_000).toFixed(6)} USDC`)
  logKV('inputs',        `${meta.inputs.length} field(s)`)
  logKV('outputs',       `${meta.outputs.length} field(s)`)
  logKV('network',       'Ethereum Sepolia')
  blank()

  // Private key
  let privateKey = getConfig().privateKey
  if (!privateKey) {
    warn('No private key found in ~/.crehub/config.json')
    note(`Set it with: crehub config set privateKey <0x...>`)
    blank()
    const input = await p.password({ message: 'Enter your wallet private key (0x...)' })
    if (p.isCancel(input)) { p.cancel('Cancelled.'); process.exit(0) }
    privateKey = String(input)

    const save = await p.confirm({ message: 'Save to ~/.crehub/config.json for future use?' })
    if (save && !p.isCancel(save)) {
      setConfigKey('privateKey', privateKey)
      ok('Private key saved to ~/.crehub/config.json')
    }
  } else {
    ok(`Private key loaded from ~/.crehub/config.json  ${pc.dim('(masked)')}`)
  }

  blank()
  const confirmed = await p.confirm({ message: `Submit ${workflowId} to WorkflowRegistry on Sepolia?` })
  if (!confirmed || p.isCancel(confirmed)) { p.cancel('Cancelled.'); process.exit(0) }

  // ── [4/4]  Submit transaction ────────────────────────────────────────────────
  phase(4, 4, 'Submitting transaction')

  const s = p.spinner()
  s.start('Signing and broadcasting transaction...')

  let txHash: `0x${string}`
  try {
    txHash = await registerWorkflow({
      workflowId:          meta.workflowId,
      price:               BigInt(meta.pricePerInvocation),
      description:         meta.description,
      detailedDescription: meta.detailedDescription,
      category:            meta.category,
      inputs:  meta.inputs.map(f  => ({ name: f.name, fieldType: f.type, description: f.description, required: f.required })),
      outputs: meta.outputs.map(f => ({ name: f.name, fieldType: f.type, description: f.description, required: f.required })),
      privateKey,
    })
    s.stop(`Transaction submitted`)
  } catch (err: any) {
    s.stop(pc.red('Transaction failed'))
    fail(err.message ?? String(err))
    blank()
    process.exit(1)
  }

  note(`Hash:  ${txHash!}`)

  const s2 = p.spinner()
  s2.start('Waiting for on-chain confirmation...')

  try {
    const receipt = await waitForTx(txHash!)
    s2.stop(`Confirmed in block ${receipt.blockNumber}`)
    note(`Gas used:  ${receipt.gasUsed.toLocaleString()} units`)
  } catch {
    s2.stop(pc.yellow('Could not confirm — check Etherscan'))
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  blank()
  footer()

  console.log(`  ${pc.green(pc.bold(`✓ ${workflowId} is live on CREHub!`))}`)
  console.log(`  ${pc.dim('Etherscan:  ')}${pc.cyan(`https://sepolia.etherscan.io/tx/${txHash!}`)}`)
  console.log(`  ${pc.dim('Marketplace:')}${pc.cyan(`https://crehub.xyz/workflow/${workflowId}`)}`)
  blank()
  note('Backend syncs new listings within ~30 seconds.')
  blank()
}
