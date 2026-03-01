/**
 * Aave health monitor workflow tests
 *
 * Tests pure functions: computeHealthFactor, classifyRisk, buildRecommendation,
 * evaluatePosition, inputSchema, and metadata.json structure.
 * No CRE runtime needed — runs with plain `bun test`.
 *
 * Run: bun test
 */
import { describe, expect, test } from 'bun:test'
import {
	computeHealthFactor,
	classifyRisk,
	buildRecommendation,
	evaluatePosition,
	inputSchema,
	DEFAULT_ALERT_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from '../src/index'
import { DEMO_WALLETS } from '../src/positions'

// ─── computeHealthFactor ─────────────────────────────────────────────────────

describe('computeHealthFactor', () => {
	test('returns Infinity when there is no debt', () => {
		const result = computeHealthFactor(
			[{ asset: 'ETH', amount: 1, liquidationThreshold: 0.825 }],
			[],
		)
		expect(result.healthFactor).toBe(Infinity)
	})

	test('computes HF correctly for a simple ETH/USDC position', () => {
		// ETH price = $2400, liqThreshold = 0.825
		// weighted collateral = 2400 * 0.825 = 1980
		// debt = 1000 USDC
		// HF = 1980 / 1000 = 1.98
		const result = computeHealthFactor(
			[{ asset: 'ETH', amount: 1, liquidationThreshold: 0.825 }],
			[{ asset: 'USDC', amount: 1_000 }],
		)
		expect(result.healthFactor).toBe(1.98)
	})

	test('collateralUsd sums all collateral positions', () => {
		const result = computeHealthFactor(
			[
				{ asset: 'ETH',  amount: 1, liquidationThreshold: 0.825 },
				{ asset: 'USDC', amount: 1_000, liquidationThreshold: 0.75 },
			],
			[{ asset: 'DAI', amount: 500 }],
		)
		expect(result.collateralUsd).toBe(2400 + 1000)
	})

	test('debtUsd sums all debt positions', () => {
		const result = computeHealthFactor(
			[{ asset: 'ETH', amount: 1, liquidationThreshold: 0.825 }],
			[
				{ asset: 'USDC', amount: 500 },
				{ asset: 'DAI',  amount: 300 },
			],
		)
		expect(result.debtUsd).toBe(800)
	})

	test('liquidationThreshold is the collateral-weighted blend', () => {
		// single asset: blended = asset liqThreshold
		const result = computeHealthFactor(
			[{ asset: 'ETH', amount: 1, liquidationThreshold: 0.825 }],
			[{ asset: 'USDC', amount: 100 }],
		)
		expect(result.liquidationThreshold).toBe(0.825)
	})
})

// ─── classifyRisk ────────────────────────────────────────────────────────────

describe('classifyRisk', () => {
	const alert    = DEFAULT_ALERT_THRESHOLD    // 1.2
	const critical = DEFAULT_CRITICAL_THRESHOLD // 1.05

	test('returns "safe" when HF ≥ alertThreshold', () => {
		expect(classifyRisk(1.5, alert, critical)).toBe('safe')
		expect(classifyRisk(1.2, alert, critical)).toBe('safe')
	})

	test('returns "warning" when criticalThreshold ≤ HF < alertThreshold', () => {
		expect(classifyRisk(1.15, alert, critical)).toBe('warning')
		// HF=1.05, criticalThreshold=1.05: 1.05 < 1.05 is false → not critical; 1.05 < 1.2 → 'warning'
		expect(classifyRisk(1.05, alert, critical)).toBe('warning')
	})

	test('returns "critical" when 1.0 ≤ HF < criticalThreshold', () => {
		expect(classifyRisk(1.04, alert, critical)).toBe('critical')
		expect(classifyRisk(1.0,  alert, critical)).toBe('critical')
	})

	test('returns "liquidatable" when HF < 1.0', () => {
		expect(classifyRisk(0.99, alert, critical)).toBe('liquidatable')
		expect(classifyRisk(0.5,  alert, critical)).toBe('liquidatable')
	})

	test('respects custom thresholds', () => {
		// HF=1.3, alert=1.5, critical=1.2: 1.3 < 1.2 false, 1.3 < 1.5 true → 'warning'
		expect(classifyRisk(1.3, 1.5, 1.2)).toBe('warning')
		expect(classifyRisk(1.6, 1.5, 1.2)).toBe('safe')
		// HF=1.15, alert=1.5, critical=1.2: 1.15 < 1.2 true → 'critical'
		expect(classifyRisk(1.15, 1.5, 1.2)).toBe('critical')
	})
})

// ─── buildRecommendation ─────────────────────────────────────────────────────

describe('buildRecommendation', () => {
	const wallet = '0xabc'

	test('safe: mentions healthy and no action required', () => {
		const msg = buildRecommendation('safe', 1.8, 1000, 1650, 1.2, wallet)
		expect(msg).toContain('healthy')
		expect(msg).toContain('No action')
	})

	test('warning: includes repay amount', () => {
		const msg = buildRecommendation('warning', 1.15, 3450, 3960, 1.2, wallet)
		expect(msg).toContain('Repay')
		expect(msg).toContain('$')
	})

	test('critical: starts with URGENT', () => {
		const msg = buildRecommendation('critical', 1.02, 1940, 1980, 1.2, wallet)
		expect(msg).toContain('URGENT')
		expect(msg).toContain(wallet)
	})

	test('liquidatable: mentions LIQUIDATION IMMINENT', () => {
		const msg = buildRecommendation('liquidatable', 0.98, 2000, 1980, 1.2, wallet)
		expect(msg).toContain('LIQUIDATION IMMINENT')
		expect(msg).toContain(wallet)
	})
})

// ─── evaluatePosition (demo wallets) ─────────────────────────────────────────

describe('evaluatePosition — demo wallets', () => {
	test('HEALTHY wallet returns riskLevel="safe" and HF > alertThreshold', () => {
		const result = evaluatePosition({
			walletAddress: DEMO_WALLETS.HEALTHY,
			alertThreshold: '1.2',
			criticalThreshold: '1.05',
		})
		expect(result.riskLevel).toBe('safe')
		expect(result.healthFactor).toBeGreaterThanOrEqual(1.2)
	})

	test('WARNING wallet returns riskLevel="warning"', () => {
		const result = evaluatePosition({
			walletAddress: DEMO_WALLETS.WARNING,
			alertThreshold: '1.2',
			criticalThreshold: '1.05',
		})
		expect(result.riskLevel).toBe('warning')
		expect(result.healthFactor).toBeLessThan(1.2)
		expect(result.healthFactor).toBeGreaterThanOrEqual(1.05)
	})

	test('CRITICAL wallet returns riskLevel="critical"', () => {
		const result = evaluatePosition({
			walletAddress: DEMO_WALLETS.CRITICAL,
			alertThreshold: '1.2',
			criticalThreshold: '1.05',
		})
		expect(result.riskLevel).toBe('critical')
		expect(result.healthFactor).toBeLessThan(1.05)
		expect(result.healthFactor).toBeGreaterThanOrEqual(1.0)
	})

	test('unknown wallet falls back to default position without throwing', () => {
		const result = evaluatePosition({ walletAddress: '0xUNKNOWN' })
		expect(typeof result.healthFactor).toBe('number')
		expect(result.healthFactor).toBeGreaterThan(0)
	})

	test('output preserves walletAddress', () => {
		const result = evaluatePosition({ walletAddress: DEMO_WALLETS.HEALTHY })
		expect(result.walletAddress).toBe(DEMO_WALLETS.HEALTHY)
	})

	test('positions array contains at least one collateral and one debt entry', () => {
		const result = evaluatePosition({ walletAddress: DEMO_WALLETS.WARNING })
		const collateral = result.positions.filter((p) => p.type === 'collateral')
		const debt = result.positions.filter((p) => p.type === 'debt')
		expect(collateral.length).toBeGreaterThan(0)
		expect(debt.length).toBeGreaterThan(0)
	})

	test('pricesUsed includes ETH and USDC', () => {
		const result = evaluatePosition({ walletAddress: DEMO_WALLETS.HEALTHY })
		expect(result.pricesUsed).toHaveProperty('ETH')
		expect(result.pricesUsed).toHaveProperty('USDC')
	})

	test('dataSource is chainlink-sample', () => {
		const result = evaluatePosition({ walletAddress: DEMO_WALLETS.HEALTHY })
		expect(result.dataSource).toBe('chainlink-sample')
	})

	test('timestamp is a valid ISO-8601 string', () => {
		const result = evaluatePosition({ walletAddress: DEMO_WALLETS.HEALTHY })
		expect(() => new Date(result.timestamp).toISOString()).not.toThrow()
	})

	test('custom alertThreshold changes risk classification', () => {
		// HEALTHY wallet has HF ~1.89. Set alertThreshold=2.0 → should be "warning"
		const result = evaluatePosition({
			walletAddress: DEMO_WALLETS.HEALTHY,
			alertThreshold: '2.0',
			criticalThreshold: '1.5',
		})
		expect(result.riskLevel).not.toBe('safe')
	})

	test('alertThreshold and criticalThreshold are reflected in output', () => {
		const result = evaluatePosition({
			walletAddress: DEMO_WALLETS.HEALTHY,
			alertThreshold: '1.5',
			criticalThreshold: '1.1',
		})
		expect(result.alertThreshold).toBe(1.5)
		expect(result.criticalThreshold).toBe(1.1)
	})
})

// ─── inputSchema ──────────────────────────────────────────────────────────────

describe('inputSchema', () => {
	test('accepts walletAddress only (thresholds are optional)', () => {
		const result = inputSchema.parse({ walletAddress: '0xabc' })
		expect(result.walletAddress).toBe('0xabc')
		expect(result.alertThreshold).toBeUndefined()
	})

	test('accepts all fields', () => {
		const result = inputSchema.parse({
			walletAddress: '0xabc',
			alertThreshold: '1.3',
			criticalThreshold: '1.1',
		})
		expect(result.alertThreshold).toBe('1.3')
	})

	test('rejects input missing walletAddress', () => {
		expect(() => inputSchema.parse({ alertThreshold: '1.2' })).toThrow()
	})
})

// ─── metadata.json structure ──────────────────────────────────────────────────

describe('metadata.json structure', () => {
	test('has all required WorkflowMetadata fields', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		const m = metadata.default
		expect(m).toHaveProperty('workflowId')
		expect(m).toHaveProperty('creatorAddress')
		expect(m).toHaveProperty('pricePerInvocation')
		expect(m).toHaveProperty('description')
		expect(m).toHaveProperty('detailedDescription')
		expect(m).toHaveProperty('inputs')
		expect(m).toHaveProperty('outputs')
		expect(m).toHaveProperty('category')
		expect(Array.isArray(m.inputs)).toBe(true)
		expect(Array.isArray(m.outputs)).toBe(true)
	})

	test('workflowId is wf_aave_health_monitor_01', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.workflowId).toBe('wf_aave_health_monitor_01')
	})

	test('category is "defi"', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.category).toBe('defi')
	})

	test('description is ≤ 160 characters', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.description.length).toBeLessThanOrEqual(160)
	})

	test('pricePerInvocation is "50000"', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.pricePerInvocation).toBe('50000')
	})

	test('each input has name, type, description, required', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		for (const field of metadata.default.inputs) {
			expect(field).toHaveProperty('name')
			expect(field).toHaveProperty('type')
			expect(field).toHaveProperty('description')
			expect(field).toHaveProperty('required')
		}
	})

	test('each output has name, type, description, required', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		for (const field of metadata.default.outputs) {
			expect(field).toHaveProperty('name')
			expect(field).toHaveProperty('type')
			expect(field).toHaveProperty('description')
			expect(field).toHaveProperty('required')
		}
	})

	test('walletAddress input is marked required=true', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		const walletInput = metadata.default.inputs.find(
			(i: { name: string }) => i.name === 'walletAddress',
		)
		expect(walletInput).toBeDefined()
		expect(walletInput!.required).toBe(true)
	})

	test('threshold inputs are optional', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		for (const name of ['alertThreshold', 'criticalThreshold']) {
			const field = metadata.default.inputs.find((i: { name: string }) => i.name === name)
			expect(field).toBeDefined()
			expect(field!.required).toBe(false)
		}
	})
})
