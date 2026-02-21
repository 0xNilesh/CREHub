/**
 * Phase 1 – CRE Workflow Template Tests
 *
 * Tests pure business logic functions extracted from src/index.ts.
 * These run with plain Bun test (no CRE runtime needed).
 *
 * Run: bun test
 */
import { describe, expect, test } from 'bun:test'
import {
	computeRiskLevel,
	fetchHealthFactor,
	inputSchema,
	type WorkflowInput,
	type WorkflowOutput,
} from '../src/index'

// ─── computeRiskLevel ─────────────────────────────────────────────────────────
describe('computeRiskLevel', () => {
	test('returns "safe" for healthFactor >= 1.5', () => {
		expect(computeRiskLevel(1.5)).toBe('safe')
		expect(computeRiskLevel(2.4)).toBe('safe')
		expect(computeRiskLevel(100)).toBe('safe')
	})

	test('returns "warning" for healthFactor in [1.1, 1.5)', () => {
		expect(computeRiskLevel(1.1)).toBe('warning')
		expect(computeRiskLevel(1.3)).toBe('warning')
		expect(computeRiskLevel(1.49)).toBe('warning')
	})

	test('returns "danger" for healthFactor < 1.1', () => {
		expect(computeRiskLevel(1.0)).toBe('danger')
		expect(computeRiskLevel(0.5)).toBe('danger')
		expect(computeRiskLevel(0)).toBe('danger')
	})

	test('boundary: exactly 1.5 is safe', () => {
		expect(computeRiskLevel(1.5)).toBe('safe')
	})

	test('boundary: exactly 1.1 is warning (not danger)', () => {
		expect(computeRiskLevel(1.1)).toBe('warning')
	})
})

// ─── inputSchema validation ───────────────────────────────────────────────────
describe('inputSchema', () => {
	test('accepts a valid Ethereum address and defaults protocol to aave', () => {
		const result = inputSchema.parse({
			walletAddress: '0xAbCd1234567890aBcD1234567890AbCd12345678',
		})
		expect(result.walletAddress).toBe('0xAbCd1234567890aBcD1234567890AbCd12345678')
		expect(result.protocol).toBe('aave')
	})

	test('accepts protocol "compound"', () => {
		const result = inputSchema.parse({
			walletAddress: '0x0000000000000000000000000000000000000001',
			protocol: 'compound',
		})
		expect(result.protocol).toBe('compound')
	})

	test('rejects addresses that are not 0x-prefixed', () => {
		expect(() =>
			inputSchema.parse({ walletAddress: 'AbCd1234567890aBcD1234567890AbCd12345678' }),
		).toThrow()
	})

	test('rejects addresses that are too short', () => {
		expect(() => inputSchema.parse({ walletAddress: '0x1234' })).toThrow()
	})

	test('rejects unknown protocol values', () => {
		expect(() =>
			inputSchema.parse({
				walletAddress: '0x0000000000000000000000000000000000000001',
				protocol: 'morpho',
			}),
		).toThrow()
	})
})

// ─── fetchHealthFactor (pure, no runtime) ─────────────────────────────────────
describe('fetchHealthFactor', () => {
	const mockConfig = {
		gatewayPublicKey: '0x0000000000000000000000000000000000000001',
		workflowId: 'test-workflow',
		apiUrl: 'https://api.example.com',
	}

	const mockInput: WorkflowInput = {
		walletAddress: '0xAbCd1234567890aBcD1234567890AbCd12345678',
		protocol: 'aave',
	}

	test('returns correct output for a healthy position (healthFactor=2.4)', () => {
		const mockSendRequester = {
			sendRequest: (_: unknown) => ({
				result: () => ({
					statusCode: 200,
					body: new TextEncoder().encode(JSON.stringify({ healthFactor: 2.4 })),
					headers: [],
				}),
			}),
		} as any

		const result = fetchHealthFactor(mockSendRequester, mockConfig, mockInput)

		expect(result.healthFactor).toBe(2.4)
		expect(result.riskLevel).toBe('safe')
	})

	test('returns "warning" for healthFactor=1.2', () => {
		const mockSendRequester = {
			sendRequest: (_: unknown) => ({
				result: () => ({
					statusCode: 200,
					body: new TextEncoder().encode(JSON.stringify({ healthFactor: 1.2 })),
					headers: [],
				}),
			}),
		} as any

		const result = fetchHealthFactor(mockSendRequester, mockConfig, mockInput)

		expect(result.healthFactor).toBe(1.2)
		expect(result.riskLevel).toBe('warning')
	})

	test('returns "danger" for healthFactor=0.95', () => {
		const mockSendRequester = {
			sendRequest: (_: unknown) => ({
				result: () => ({
					statusCode: 200,
					body: new TextEncoder().encode(JSON.stringify({ healthFactor: 0.95 })),
					headers: [],
				}),
			}),
		} as any

		const result = fetchHealthFactor(mockSendRequester, mockConfig, mockInput)

		expect(result.healthFactor).toBe(0.95)
		expect(result.riskLevel).toBe('danger')
	})

	test('throws on non-200 API response', () => {
		const mockSendRequester = {
			sendRequest: (_: unknown) => ({
				result: () => ({
					statusCode: 500,
					body: new TextEncoder().encode('Internal Server Error'),
					headers: [],
				}),
			}),
		} as any

		expect(() => fetchHealthFactor(mockSendRequester, mockConfig, mockInput)).toThrow(
			'API request failed with status: 500',
		)
	})

	test('throws when healthFactor is not a number', () => {
		const mockSendRequester = {
			sendRequest: (_: unknown) => ({
				result: () => ({
					statusCode: 200,
					body: new TextEncoder().encode(JSON.stringify({ healthFactor: 'invalid' })),
					headers: [],
				}),
			}),
		} as any

		expect(() => fetchHealthFactor(mockSendRequester, mockConfig, mockInput)).toThrow(
			'non-numeric healthFactor',
		)
	})

	test('uses the configured apiUrl correctly', () => {
		let capturedUrl: string | undefined

		const mockSendRequester = {
			sendRequest: (req: { url: string }) => {
				capturedUrl = req.url
				return {
					result: () => ({
						statusCode: 200,
						body: new TextEncoder().encode(JSON.stringify({ healthFactor: 1.8 })),
						headers: [],
					}),
				}
			},
		} as any

		fetchHealthFactor(mockSendRequester, mockConfig, mockInput)

		expect(capturedUrl).toBe(
			`https://api.example.com/health-factor/${mockInput.walletAddress}?protocol=aave`,
		)
	})

	test('uses protocol in the request URL', () => {
		let capturedUrl: string | undefined

		const mockSendRequester = {
			sendRequest: (req: { url: string }) => {
				capturedUrl = req.url
				return {
					result: () => ({
						statusCode: 200,
						body: new TextEncoder().encode(JSON.stringify({ healthFactor: 1.8 })),
						headers: [],
					}),
				}
			},
		} as any

		fetchHealthFactor(mockSendRequester, mockConfig, { ...mockInput, protocol: 'compound' })

		expect(capturedUrl).toContain('protocol=compound')
	})
})

// ─── metadata.json schema check ───────────────────────────────────────────────
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

	test('each input field has name, type, description, required', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		for (const field of metadata.default.inputs) {
			expect(field).toHaveProperty('name')
			expect(field).toHaveProperty('type')
			expect(field).toHaveProperty('description')
			expect(field).toHaveProperty('required')
		}
	})

	test('each output field has name, type, description, required', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		for (const field of metadata.default.outputs) {
			expect(field).toHaveProperty('name')
			expect(field).toHaveProperty('type')
			expect(field).toHaveProperty('description')
			expect(field).toHaveProperty('required')
		}
	})

	test('description is ≤ 160 characters', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.description.length).toBeLessThanOrEqual(160)
	})

	test('category is a recognised value', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		const validCategories = ['defi', 'monitoring', 'data', 'compute']
		expect(validCategories).toContain(metadata.default.category)
	})
})
