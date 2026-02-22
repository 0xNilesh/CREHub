/**
 * Hello-world workflow tests
 *
 * Tests the pure buildGreeting function and metadata.json structure.
 * No CRE runtime needed — runs with plain `bun test`.
 *
 * Run: bun test
 */
import { describe, expect, test } from 'bun:test'
import { buildGreeting, inputSchema } from '../src/index'

// ─── buildGreeting ────────────────────────────────────────────────────────────

describe('buildGreeting', () => {
	test('returns "Hello, World!" when name is omitted', () => {
		const result = buildGreeting({})
		expect(result.message).toBe('Hello, World!')
		expect(typeof result.timestamp).toBe('string')
	})

	test('returns "Hello, Alice!" when name is "Alice"', () => {
		const result = buildGreeting({ name: 'Alice' })
		expect(result.message).toBe('Hello, Alice!')
	})

	test('timestamp is a valid ISO-8601 string', () => {
		const result = buildGreeting({})
		expect(() => new Date(result.timestamp).toISOString()).not.toThrow()
	})
})

// ─── inputSchema ──────────────────────────────────────────────────────────────

describe('inputSchema', () => {
	test('accepts empty object (name is optional)', () => {
		const result = inputSchema.parse({})
		expect(result.name).toBeUndefined()
	})

	test('accepts a name string', () => {
		const result = inputSchema.parse({ name: 'Bob' })
		expect(result.name).toBe('Bob')
	})

	test('rejects non-string name', () => {
		expect(() => inputSchema.parse({ name: 42 })).toThrow()
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

	test('workflowId is wf_hello_world_01', async () => {
		const metadata = await import('../metadata.json', { assert: { type: 'json' } })
		expect(metadata.default.workflowId).toBe('wf_hello_world_01')
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
})
