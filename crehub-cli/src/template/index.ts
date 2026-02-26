/**
 * Embedded scaffold templates.
 * {{PLACEHOLDER}} tokens are replaced by the init command.
 */

export const SRC_INDEX_TS = `import {
\tHTTPCapability,
\tHTTPClient,
\ttype HTTPPayload,
\tdecodeJson,
\thandler,
\tRunner,
\ttype Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'

// ─── Config ───────────────────────────────────────────────────────────────────
// Fields here are read from config.json at runtime.
// Add API keys, addresses, or any other secrets your workflow needs.

const configSchema = z.object({
\tgatewayPublicKey: z.string(),
\tworkflowId: z.string(),
\t// myApiKey: z.string(),
})

export type Config = z.infer<typeof configSchema>

// ─── Input Schema ─────────────────────────────────────────────────────────────
// These fields are sent by the agent in the HTTP trigger payload.

export const inputSchema = z.object({
{{INPUT_SCHEMA}}})

export type WorkflowInput = z.infer<typeof inputSchema>

// ─── Output ───────────────────────────────────────────────────────────────────

export interface WorkflowOutput {
{{OUTPUT_INTERFACE}}\ttimestamp: string
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
// IMPORTANT: This function must be synchronous — no async/await.
// HTTPClient.sendRequest(...).result() is already synchronous.

export const onHTTPTrigger = (
\truntime: Runtime<Config>,
\tpayload: HTTPPayload,
): WorkflowOutput => {
\truntime.log('[{{WORKFLOW_ID}}] Trigger received')

\tconst rawInput = decodeJson(payload.input)
\tconst input = inputSchema.parse(rawInput)

\t// ── Your workflow logic ──────────────────────────────────────────────────
\t// Access config:   runtime.config.myApiKey
\t// Outgoing HTTP:   const http = new HTTPClient()
\t//                  const resp = http.sendRequest(runtime, {
\t//                    url: 'https://api.example.com/data',
\t//                    method: 'GET',
\t//                    headers: { 'Authorization': \`Bearer \${runtime.config.myApiKey}\` },
\t//                    cache_settings: { store: false },
\t//                  }).result()
\t//                  const data = JSON.parse(new TextDecoder().decode(resp.body))
\t// ─────────────────────────────────────────────────────────────────────────

\treturn {
\t\ttimestamp: new Date().toISOString(),
\t}
}

// ─── Workflow Init ────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
\tconst httpCapability = new HTTPCapability()

\treturn [
\t\thandler(
\t\t\thttpCapability.trigger({
\t\t\t\tauthorizedKeys: [
\t\t\t\t\t{
\t\t\t\t\t\ttype: 'KEY_TYPE_ECDSA_EVM',
\t\t\t\t\t\tpublicKey: config.gatewayPublicKey,
\t\t\t\t\t},
\t\t\t\t],
\t\t\t}),
\t\t\tonHTTPTrigger,
\t\t),
\t]
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function main() {
\tconst runner = await Runner.newRunner<Config>({ configSchema })
\tawait runner.run(initWorkflow)
}
`

export const CONFIG_JSON = (gatewayPublicKey: string, workflowId: string) => JSON.stringify({
  gatewayPublicKey,
  workflowId,
  // "myApiKey": "YOUR_API_KEY_HERE"
}, null, 2) + '\n'

export const METADATA_JSON = (meta: {
  workflowId:          string
  creatorAddress:      string
  pricePerInvocation:  string
  description:         string
  detailedDescription: string
  category:            string
  inputs:  Array<{ name: string; type: string; description: string; required: boolean }>
  outputs: Array<{ name: string; type: string; description: string; required: boolean }>
}) => JSON.stringify(meta, null, 2) + '\n'

export const WORKFLOW_YAML = (workflowId: string) => `# CRE WORKFLOW SETTINGS — ${workflowId}

local-simulation:
  user-workflow:
    workflow-name: "crehub-${workflowId}-local"
  workflow-artifacts:
    workflow-path: "./src/index.ts"
    config-path: "./config.json"

staging-settings:
  user-workflow:
    workflow-name: "crehub-${workflowId}-staging"
  workflow-artifacts:
    workflow-path: "./src/index.ts"
    config-path: "./config.json"

production-settings:
  user-workflow:
    workflow-name: "crehub-${workflowId}-production"
  workflow-artifacts:
    workflow-path: "./src/index.ts"
    config-path: "./config.json"
`

export const PROJECT_YAML = `# CRE PROJECT SETTINGS

local-simulation:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com

staging-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com

production-settings:
  cre-cli:
    don-family: "zone-a"
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: https://ethereum-sepolia-rpc.publicnode.com
`

export const PACKAGE_JSON = (name: string, workflowId: string) => JSON.stringify({
  name: `@crehub/workflow-${name}`,
  version: '0.1.0',
  private: true,
  type: 'module',
  description: `CREHub workflow — ${workflowId}`,
  scripts: {
    'cre-compile': 'bun scripts/cre-compile.ts',
    simulate:      'cre workflow simulate . --target local-simulation',
    typecheck:     'tsc --noEmit',
    test:          'bun test',
  },
  dependencies: {
    '@chainlink/cre-sdk': '^1.1.1',
    zod: '3.25.76',
  },
  devDependencies: {
    '@types/bun': '1.3.8',
    typescript:   '^5.0.0',
  },
  engines: { bun: '>=1.2.21' },
}, null, 2) + '\n'

export const TSCONFIG_JSON = JSON.stringify({
  compilerOptions: {
    lib: ['ESNext'],
    target: 'ESNext',
    module: 'ESNext',
    moduleDetection: 'force',
    allowJs: true,
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
  },
  include: ['src/**/*', 'tests/**/*'],
}, null, 2) + '\n'

export const CRE_COMPILE_TS = `#!/usr/bin/env bun
import { execSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const [, wasmOut = 'tmp.wasm'] = process.argv.slice(2)

let workflowSrcDir = 'src'
try {
\tconst yaml = readFileSync('workflow.yaml', 'utf8')
\tconst match = yaml.match(/workflow-path\\s*:\\s*["']?\\.\\/([^/\\s"']+)\\//)
\tif (match) workflowSrcDir = match[1]
} catch { /* fall back to 'src' */ }

const srcFile = join(workflowSrcDir, 'index.ts')
const wasmPath = join(workflowSrcDir, basename(wasmOut))

if (existsSync(wasmPath) && existsSync(srcFile)) {
\tconst wasmMtime = statSync(wasmPath).mtimeMs
\tconst srcMtime  = statSync(srcFile).mtimeMs
\tif (wasmMtime > srcMtime) {
\t\tconsole.log('[cre-compile] WASM cache hit — skipping recompilation')
\t\tprocess.exit(0)
\t}
}

console.log(\`[cre-compile] Compiling \${srcFile} → \${wasmPath}\`)
execSync(\`bun x cre-compile "\${srcFile}" "\${wasmPath}"\`, { stdio: 'inherit' })
`
