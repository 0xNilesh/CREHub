/**
 * Metadata + schema validation helpers used by doctor and test commands.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config.ts'

export const VALID_CATEGORIES = ['defi', 'monitoring', 'data', 'compute', 'ai'] as const
export const VALID_FIELD_TYPES = ['string', 'number', 'boolean', 'address', 'object'] as const

export interface MetadataField {
  name:        string
  type:        string
  description: string
  required:    boolean
}

export interface WorkflowMetadata {
  workflowId:          string
  creatorAddress:      string
  pricePerInvocation:  string
  description:         string
  detailedDescription: string
  category:            string
  inputs:              MetadataField[]
  outputs:             MetadataField[]
}

export interface DoctorCheck {
  name:    string
  passed:  boolean
  message: string
}

export const loadMetadata = (workflowDir: string): WorkflowMetadata | null => {
  const p = join(workflowDir, 'metadata.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export const loadConfig = (workflowDir: string): Record<string, string> | null => {
  const p = join(workflowDir, 'config.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// Checks if a value is a placeholder (e.g. "YOUR_API_KEY_HERE")
export const isPlaceholder = (val: string): boolean =>
  /YOUR_|_HERE|PLACEHOLDER|TODO|<.*>/i.test(val)

export const runDoctorChecks = async (
  workflowDir: string,
  opts: { checkOnChain?: boolean } = {},
): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = []
  const add = (name: string, passed: boolean, message: string) =>
    checks.push({ name, passed, message })

  // 1. metadata.json exists
  const meta = loadMetadata(workflowDir)
  add('metadata.json exists', !!meta, meta ? 'metadata.json found' : 'metadata.json missing')
  if (!meta) return checks

  // 2. workflowId format
  const idOk = /^wf_[a-z0-9_]+_\d{2}$/.test(meta.workflowId)
  add('workflowId format', idOk,
    idOk ? `workflowId: ${meta.workflowId}` : `"${meta.workflowId}" must match wf_[name]_NN`)

  // 3. description length
  const descOk = meta.description?.length > 0 && meta.description.length <= 160
  add('description',  descOk,
    descOk ? `${meta.description.length} chars` : `missing or exceeds 160 chars (${meta.description?.length ?? 0})`)

  // 4. detailedDescription
  const detailOk = (meta.detailedDescription ?? '').length > 0
  add('detailedDescription', detailOk, detailOk ? 'present' : 'missing or empty')

  // 5. category
  const catOk = VALID_CATEGORIES.includes(meta.category as any)
  add('category', catOk,
    catOk ? `category: ${meta.category}` : `"${meta.category}" not in [${VALID_CATEGORIES.join('|')}]`)

  // 6. pricePerInvocation
  const priceOk = !isNaN(Number(meta.pricePerInvocation))
  add('pricePerInvocation', priceOk,
    priceOk ? `${meta.pricePerInvocation} wei` : 'must be a numeric string')

  // 7. inputs / outputs schema
  const fieldsOk = Array.isArray(meta.inputs) && Array.isArray(meta.outputs) &&
    [...meta.inputs, ...meta.outputs].every(f => f.name && f.type && f.description !== undefined)
  add('inputs/outputs schema', fieldsOk,
    fieldsOk
      ? `${meta.inputs.length} input(s), ${meta.outputs.length} output(s)`
      : 'each field needs name, type, description, required')

  // 8. config.json exists
  const cfg = loadConfig(workflowDir)
  add('config.json exists', !!cfg, cfg ? 'config.json found' : 'config.json missing')

  // 9. gatewayPublicKey matches CREHub's key
  if (cfg) {
    const { gatewayPublicKey: expected } = getConfig()
    const actual = cfg['gatewayPublicKey'] ?? ''
    const keyOk  = actual.toLowerCase() === expected.toLowerCase()
    add('gatewayPublicKey',  keyOk,
      keyOk ? actual : `expected ${expected}, got ${actual || '(missing)'}`)

    // 10. No placeholder API keys
    const placeholders = Object.entries(cfg)
      .filter(([k, v]) => k !== 'gatewayPublicKey' && k !== 'workflowId' && isPlaceholder(String(v)))
      .map(([k]) => k)
    add('no placeholder config values', placeholders.length === 0,
      placeholders.length === 0 ? 'all config values set' : `placeholders in: ${placeholders.join(', ')}`)
  }

  // 11. src/index.ts
  const srcOk = existsSync(join(workflowDir, 'src', 'index.ts'))
  add('src/index.ts exists', srcOk, srcOk ? 'found' : 'src/index.ts missing')

  // 12. workflow.yaml
  const yamlOk = existsSync(join(workflowDir, 'workflow.yaml'))
  add('workflow.yaml exists', yamlOk, yamlOk ? 'found' : 'workflow.yaml missing')

  // 13. WASM compiled
  const wasmOk = existsSync(join(workflowDir, 'src', 'tmp.wasm'))
  add('WASM compiled', wasmOk, wasmOk ? 'src/tmp.wasm found' : 'run: bun run cre-compile')

  // 14. Not already on-chain (optional, needs RPC)
  if (opts.checkOnChain) {
    try {
      const { workflowExists } = await import('./contract.ts')
      const exists = await workflowExists(meta.workflowId)
      add('not yet on-chain', !exists,
        exists ? `${meta.workflowId} already registered — use crehub list to re-check` : 'not registered yet')
    } catch {
      add('on-chain check', false, 'could not reach RPC — skipped')
    }
  }

  return checks
}

// Validate actual output JSON against metadata outputs schema
export const validateOutputSchema = (
  output: Record<string, unknown>,
  expectedOutputs: MetadataField[],
): Array<{ field: string; passed: boolean; expected: string; actual: string }> => {
  return expectedOutputs.map(f => {
    const val = output[f.name]
    const present = val !== undefined && val !== null
    if (!present && f.required) {
      return { field: f.name, passed: false, expected: f.type, actual: '(missing)' }
    }
    if (!present) {
      return { field: f.name, passed: true, expected: f.type, actual: '(optional, omitted)' }
    }
    // Type check (loose)
    const actualType = typeof val
    const typeOk = f.type === 'object'
      ? (actualType === 'object' || actualType === 'string')  // indicators may be object or json string
      : actualType === f.type || (f.type === 'number' && !isNaN(Number(val)))
    const display = actualType === 'object'
      ? JSON.stringify(val).slice(0, 40) + '...'
      : String(val).slice(0, 50)
    return { field: f.name, passed: typeOk, expected: f.type, actual: display }
  })
}
