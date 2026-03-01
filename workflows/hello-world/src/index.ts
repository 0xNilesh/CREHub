import {
	HTTPCapability,
	EVMClient,
	type HTTPPayload,
	decodeJson,
	handler,
	Runner,
	type Runtime,
	TxStatus,
	bytesToHex,
	prepareReportRequest,
	getNetwork,
} from '@chainlink/cre-sdk'
import { z } from 'zod'
import { encodeReport, hashOutput } from './reportEncoder'

// ─── Config ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
	gatewayPublicKey: z.string(),
	workflowId: z.string(),
	chainSelectorSepolia: z.string(),
	executorAddress: z.string(),
	gasLimit: z.number(),
	/** Set true in local-simulation to skip the on-chain write step. */
	skipOnChainWrite: z.boolean().optional(),
})

export type Config = z.infer<typeof configSchema>

// ─── Input ────────────────────────────────────────────────────────────────────

export const inputSchema = z.object({
	name: z.string().optional(),
})

export type WorkflowInput = z.infer<typeof inputSchema>

// ─── Output ───────────────────────────────────────────────────────────────────

export interface WorkflowOutput {
	message: string
	timestamp: string
	/** Sepolia tx hash of the CRE on-chain write, present when the broadcast step ran. */
	onChainTxHash?: string
}

// ─── Pure Business Logic ──────────────────────────────────────────────────────
// Extracted so it can be unit-tested without the CRE runtime.

export const buildGreeting = (input: WorkflowInput): Omit<WorkflowOutput, 'onChainTxHash'> => ({
	message: `Hello, ${input.name ?? 'World'}!`,
	timestamp: new Date().toISOString(),
})

// ─── HTTP Trigger Handler ─────────────────────────────────────────────────────

export const onHTTPTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): WorkflowOutput => {
	runtime.log('CREHub hello-world trigger received')

	const rawInput = decodeJson(payload.input)
	const input = inputSchema.parse(rawInput)

	runtime.log(`Input: name=${input.name ?? '(none)'}`)

	const output = buildGreeting(input)

	runtime.log(`Output: message="${output.message}" timestamp="${output.timestamp}"`)

	// ── Broadcast result hash to Sepolia via CRE Forwarder ──
	if (runtime.config.skipOnChainWrite) {
		runtime.log('[on-chain] skipOnChainWrite=true — skipping broadcast (local simulation)')
		return output
	}

	runtime.log('[on-chain] Encoding workflow report...')
	const resultHash = hashOutput(output)
	const reportPayload = encodeReport(runtime.config.workflowId, resultHash)

	runtime.log('[on-chain] Generating CRE report...')
	const reportResponse = runtime
		.report(prepareReportRequest(reportPayload))
		.result()

	runtime.log(`[on-chain] Writing to CREHubExecutor on Sepolia: ${runtime.config.executorAddress}`)
	const sepoliaNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: runtime.config.chainSelectorSepolia,
		isTestnet: true,
	})
	if (!sepoliaNetwork) {
		throw new Error(`[on-chain] Unknown chain: ${runtime.config.chainSelectorSepolia}`)
	}

	const evmClient = new EVMClient(sepoliaNetwork.chainSelector.selector)
	const writeResult = evmClient
		.writeReport(runtime, {
			receiver: runtime.config.executorAddress,
			report: reportResponse,
			gasConfig: { gasLimit: String(runtime.config.gasLimit) },
		})
		.result()

	if (writeResult.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`[on-chain] Transaction failed: ${writeResult.txStatus}`)
	}

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
	runtime.log(`[on-chain] ✓ Transaction confirmed: ${txHash}`)

	return { ...output, onChainTxHash: txHash }
}

// ─── Workflow Init ────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
	const httpCapability = new HTTPCapability()

	return [
		handler(
			httpCapability.trigger({
				authorizedKeys: [
					{
						type: 'KEY_TYPE_ECDSA_EVM',
						publicKey: config.gatewayPublicKey,
					},
				],
			}),
			onHTTPTrigger,
		),
	]
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}
