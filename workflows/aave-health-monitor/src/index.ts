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
import { CHAINLINK_PRICES, getPriceUsd } from './prices'
import { SAMPLE_POSITIONS, DEFAULT_POSITION } from './positions'

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
	walletAddress: z.string(),
	/** HF below this level triggers a "warning" risk level. Default: 1.2 */
	alertThreshold: z.string().optional(),
	/** HF below this level triggers a "critical" risk level. Default: 1.05 */
	criticalThreshold: z.string().optional(),
})

export type WorkflowInput = z.infer<typeof inputSchema>

// ─── Output ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'safe' | 'warning' | 'critical' | 'liquidatable'

export interface PositionLine {
	asset: string
	type: 'collateral' | 'debt'
	amount: number
	valueUsd: number
	liquidationThreshold?: number
	weightedValueUsd?: number
}

export interface WorkflowOutput {
	walletAddress: string
	healthFactor: number
	riskLevel: RiskLevel
	alertThreshold: number
	criticalThreshold: number
	collateralUsd: number
	weightedCollateralUsd: number
	debtUsd: number
	liquidationThreshold: number
	recommendation: string
	positions: PositionLine[]
	pricesUsed: Record<string, number>
	dataSource: 'chainlink-sample'
	timestamp: string
	/** Sepolia tx hash of the CRE on-chain write, present when the broadcast step ran. */
	onChainTxHash?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_ALERT_THRESHOLD    = 1.2
export const DEFAULT_CRITICAL_THRESHOLD = 1.05

// ─── Pure Business Logic ──────────────────────────────────────────────────────
// Extracted so it can be unit-tested without the CRE runtime.

export const computeHealthFactor = (
	collateral: Array<{ asset: string; amount: number; liquidationThreshold: number }>,
	debt: Array<{ asset: string; amount: number }>,
): { healthFactor: number; collateralUsd: number; weightedCollateralUsd: number; debtUsd: number; liquidationThreshold: number } => {
	let collateralUsd = 0
	let weightedCollateralUsd = 0

	for (const c of collateral) {
		const valueUsd = c.amount * getPriceUsd(c.asset)
		collateralUsd += valueUsd
		weightedCollateralUsd += valueUsd * c.liquidationThreshold
	}

	let debtUsd = 0
	for (const d of debt) {
		debtUsd += d.amount * getPriceUsd(d.asset)
	}

	const healthFactor = debtUsd === 0 ? Infinity : weightedCollateralUsd / debtUsd
	const blendedLiqThreshold = collateralUsd === 0 ? 0 : weightedCollateralUsd / collateralUsd

	return {
		healthFactor: Math.round(healthFactor * 1000) / 1000,
		collateralUsd: Math.round(collateralUsd * 100) / 100,
		weightedCollateralUsd: Math.round(weightedCollateralUsd * 100) / 100,
		debtUsd: Math.round(debtUsd * 100) / 100,
		liquidationThreshold: Math.round(blendedLiqThreshold * 10000) / 10000,
	}
}

export const classifyRisk = (
	healthFactor: number,
	alertThreshold: number,
	criticalThreshold: number,
): RiskLevel => {
	if (healthFactor < 1.0)             return 'liquidatable'
	if (healthFactor < criticalThreshold) return 'critical'
	if (healthFactor < alertThreshold)  return 'warning'
	return 'safe'
}

export const buildRecommendation = (
	riskLevel: RiskLevel,
	healthFactor: number,
	debtUsd: number,
	weightedCollateralUsd: number,
	alertThreshold: number,
	walletAddress: string,
): string => {
	// Repay amount to reach alertThreshold: debtUsd - (weightedCollateral / alertThreshold)
	const repayToSafe = Math.max(0, debtUsd - weightedCollateralUsd / alertThreshold)

	switch (riskLevel) {
		case 'safe':
			return `Position is healthy (HF ${healthFactor}). No action required. Monitor if ETH drops >15%.`

		case 'warning':
			return `Health factor ${healthFactor} is below alert threshold ${alertThreshold}. Repay ~$${repayToSafe.toFixed(2)} debt or add equivalent collateral to return to safe zone.`

		case 'critical':
			return `URGENT: Health factor ${healthFactor} is critically low. Repay ~$${repayToSafe.toFixed(2)} debt immediately. A 2–3% price drop could trigger liquidation for ${walletAddress}.`

		case 'liquidatable':
			return `LIQUIDATION IMMINENT: Health factor ${healthFactor} is below 1.0. Position ${walletAddress} is eligible for liquidation now. Add collateral or repay all debt immediately.`
	}
}

export const evaluatePosition = (input: WorkflowInput): WorkflowOutput => {
	const alertThreshold    = parseFloat(input.alertThreshold    || String(DEFAULT_ALERT_THRESHOLD))
	const criticalThreshold = parseFloat(input.criticalThreshold || String(DEFAULT_CRITICAL_THRESHOLD))

	const position = SAMPLE_POSITIONS[input.walletAddress] ?? DEFAULT_POSITION

	const { healthFactor, collateralUsd, weightedCollateralUsd, debtUsd, liquidationThreshold } =
		computeHealthFactor(position.collateral, position.debt)

	const riskLevel = classifyRisk(healthFactor, alertThreshold, criticalThreshold)

	const recommendation = buildRecommendation(
		riskLevel,
		healthFactor,
		debtUsd,
		weightedCollateralUsd,
		alertThreshold,
		input.walletAddress,
	)

	// Build per-asset position breakdown for the output
	const positions: PositionLine[] = [
		...position.collateral.map((c) => {
			const valueUsd = Math.round(c.amount * getPriceUsd(c.asset) * 100) / 100
			return {
				asset: c.asset,
				type: 'collateral' as const,
				amount: c.amount,
				valueUsd,
				liquidationThreshold: c.liquidationThreshold,
				weightedValueUsd: Math.round(valueUsd * c.liquidationThreshold * 100) / 100,
			}
		}),
		...position.debt.map((d) => ({
			asset: d.asset,
			type: 'debt' as const,
			amount: d.amount,
			valueUsd: Math.round(d.amount * getPriceUsd(d.asset) * 100) / 100,
		})),
	]

	const pricesUsed = Object.fromEntries(
		Object.entries(CHAINLINK_PRICES).map(([k, v]) => [k, v.priceUsd]),
	)

	return {
		walletAddress: input.walletAddress,
		healthFactor,
		riskLevel,
		alertThreshold,
		criticalThreshold,
		collateralUsd,
		weightedCollateralUsd,
		debtUsd,
		liquidationThreshold,
		recommendation,
		positions,
		pricesUsed,
		dataSource: 'chainlink-sample',
		timestamp: new Date().toISOString(),
	}
}

// ─── HTTP Trigger Handler ─────────────────────────────────────────────────────

export const onHTTPTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): WorkflowOutput => {
	runtime.log('CREHub aave-health-monitor trigger received')

	const rawInput = decodeJson(payload.input)
	const input = inputSchema.parse(rawInput)

	runtime.log(`Input: wallet=${input.walletAddress} alertThreshold=${input.alertThreshold ?? DEFAULT_ALERT_THRESHOLD} criticalThreshold=${input.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD}`)

	const output = evaluatePosition(input)

	runtime.log(`HF=${output.healthFactor} riskLevel=${output.riskLevel} collateral=$${output.collateralUsd} debt=$${output.debtUsd}`)
	runtime.log(`Recommendation: ${output.recommendation}`)

	// ── Step 2: Broadcast result hash to Sepolia via CRE Forwarder ──
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

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}
