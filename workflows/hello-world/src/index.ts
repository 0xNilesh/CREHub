import {
	HTTPCapability,
	type HTTPPayload,
	decodeJson,
	handler,
	Runner,
	type Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'

// ─── Config ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
	gatewayPublicKey: z.string(),
	workflowId: z.string(),
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
}

// ─── Pure Business Logic ──────────────────────────────────────────────────────
// Extracted so it can be unit-tested without the CRE runtime.

export const buildGreeting = (input: WorkflowInput): WorkflowOutput => ({
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

	return output
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
