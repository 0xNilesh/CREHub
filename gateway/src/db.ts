/**
 * MongoDB read layer for the gateway.
 *
 * Connects to the same 'crehub' database and 'workflows' collection
 * that the backend writes to via its event listener.
 *
 * The gateway is read-only — it never writes to MongoDB directly.
 * Workflow documents are created by the backend when WorkflowListed
 * events are emitted on-chain.
 *
 * Field mapping note:
 *   MongoDB document stores IO fields with key 'fieldType' (backend convention).
 *   Gateway's WorkflowIOField uses 'type'. This is mapped on read.
 */
import { MongoClient, MongoServerError, type Collection, type Db } from 'mongodb'
import type { WorkflowMetadata } from './types'
import { WORKFLOW_DIRS } from './workflow-dirs'

const DB_NAME              = 'crehub'
const COLLECTION           = 'workflows'
const PAYMENTS_COLLECTION  = 'gateway_payments'
const EXECUTIONS_COLLECTION = 'executions'

// ─── Execution records ────────────────────────────────────────────────────────

export interface ExecutionDocument {
	executionId:      string  // on-chain bytes32 (unique)
	workflowId:       string
	agentAddress:     string  // who paid
	creatorAddress:   string  // workflow creator
	amount:           string  // USDC wei
	inputsJson:       string
	outputsJson:      string  // "" until settled
	errorMessage:     string  // "" until settled
	status:           'pending' | 'success' | 'failure'
	paymentTxHash:    string  // X-PAYMENT header (USDC transfer tx)
	settlementTxHash: string  // settleSuccess / settleFailure tx hash
	triggeredAt:      Date
	settledAt:        Date | null
}

// ─── Payment deduplication ────────────────────────────────────────────────────

interface PaymentDocument {
	txHash:      string   // Sepolia USDC transfer tx hash (unique index)
	workflowId:  string
	agentAddress: string
	amount:      string   // USDC wei
	usedAt:      Date
}

// ─── Workflow documents ───────────────────────────────────────────────────────

// Matches the shape written by backend/src/db.ts
interface WorkflowDocument {
	workflowId: string
	creatorAddress: string
	pricePerInvocation: string
	description: string
	detailedDescription: string
	category: string
	active: boolean
	registeredAt: string
	inputs: Array<{ name: string; fieldType: string; description: string; required: boolean }>
	outputs: Array<{ name: string; fieldType: string; description: string; required: boolean }>
	workflowDir?: string // set if manually overridden; otherwise falls back to default
}

let _client: MongoClient | undefined
let _db: Db | undefined

const col = (): Collection<WorkflowDocument> => {
	if (!_db) throw new Error('Gateway DB not connected — call connectDb() first')
	return _db.collection<WorkflowDocument>(COLLECTION)
}

const paymentsCol = (): Collection<PaymentDocument> => {
	if (!_db) throw new Error('Gateway DB not connected — call connectDb() first')
	return _db.collection<PaymentDocument>(PAYMENTS_COLLECTION)
}

const executionsCol = (): Collection<ExecutionDocument> => {
	if (!_db) throw new Error('Gateway DB not connected — call connectDb() first')
	return _db.collection<ExecutionDocument>(EXECUTIONS_COLLECTION)
}

// ─── Connection ───────────────────────────────────────────────────────────────

export const connectDb = async (): Promise<void> => {
	const uri = process.env.MONGODB_URI
	if (!uri) throw new Error('MONGODB_URI environment variable is not set')

	// Bun TLS bug: checkServerIdentity receives a null peer cert on Atlas SRV
	// connections, crashing node:tls. Supplying () => undefined skips the check.
	_client = new MongoClient(uri, { checkServerIdentity: () => undefined })
	await _client.connect()
	_db = _client.db(DB_NAME)

	// Unique index on txHash — enforces payment deduplication at the DB level.
	// createIndex is idempotent; safe to call on every startup.
	await _db
		.collection<PaymentDocument>(PAYMENTS_COLLECTION)
		.createIndex({ txHash: 1 }, { unique: true })

	await _db
		.collection<ExecutionDocument>(EXECUTIONS_COLLECTION)
		.createIndex({ executionId: 1 }, { unique: true })

	await _db
		.collection<ExecutionDocument>(EXECUTIONS_COLLECTION)
		.createIndex({ agentAddress: 1, triggeredAt: -1 })

	await _db
		.collection<ExecutionDocument>(EXECUTIONS_COLLECTION)
		.createIndex({ workflowId: 1, triggeredAt: -1 })

	console.log('[gateway/db] Connected to MongoDB')
}

export const closeDb = async (): Promise<void> => {
	await _client?.close()
}

// ─── Conversion ───────────────────────────────────────────────────────────────

const fromDocument = (doc: WorkflowDocument, defaultWorkflowDir: string): WorkflowMetadata => ({
	workflowId: doc.workflowId,
	creatorAddress: doc.creatorAddress as `0x${string}`,
	pricePerInvocation: doc.pricePerInvocation,
	description: doc.description,
	detailedDescription: doc.detailedDescription,
	category: doc.category as WorkflowMetadata['category'],
	active: doc.active,
	// Map 'fieldType' (backend key) → 'type' (gateway key)
	inputs: doc.inputs.map((f) => ({
		name: f.name,
		type: f.fieldType as WorkflowMetadata['inputs'][number]['type'],
		description: f.description,
		required: f.required,
	})),
	outputs: doc.outputs.map((f) => ({
		name: f.name,
		type: f.fieldType as WorkflowMetadata['outputs'][number]['type'],
		description: f.description,
		required: f.required,
	})),
	// Priority: static WORKFLOW_DIRS map → doc-level override → server default
	workflowDir: WORKFLOW_DIRS[doc.workflowId] ?? doc.workflowDir ?? defaultWorkflowDir,
})

// ─── Read ─────────────────────────────────────────────────────────────────────

export const getAllActive = async (defaultWorkflowDir: string): Promise<WorkflowMetadata[]> => {
	const docs = await col().find({ active: true }).toArray()
	return docs.map((doc) => fromDocument(doc, defaultWorkflowDir))
}

export const getOne = async (
	workflowId: string,
	defaultWorkflowDir: string,
): Promise<WorkflowMetadata | null> => {
	const doc = await col().findOne({ workflowId })
	return doc ? fromDocument(doc, defaultWorkflowDir) : null
}

// ─── Payment deduplication ────────────────────────────────────────────────────

// ─── Execution tracking ───────────────────────────────────────────────────────

export const saveExecution = async (doc: ExecutionDocument): Promise<void> => {
	await executionsCol().insertOne(doc)
}

export const settleExecution = async (
	executionId: string,
	update: { status: 'success' | 'failure'; outputsJson: string; errorMessage: string; settlementTxHash: string },
): Promise<void> => {
	await executionsCol().updateOne(
		{ executionId },
		{ $set: { ...update, settledAt: new Date() } },
	)
}

// ─── Payment deduplication ────────────────────────────────────────────────────

/**
 * Atomically mark a payment tx hash as consumed.
 *
 * Returns `true`  if the hash was fresh (inserted successfully).
 * Returns `false` if the hash was already used (duplicate key error).
 *
 * The unique index guarantees race-condition safety: two simultaneous requests
 * with the same txHash will result in exactly one succeeding.
 */
export const markPaymentUsed = async (params: {
	txHash:      string
	workflowId:  string
	agentAddress: string
	amount:      string
}): Promise<boolean> => {
	try {
		await paymentsCol().insertOne({
			txHash:       params.txHash,
			workflowId:   params.workflowId,
			agentAddress: params.agentAddress,
			amount:       params.amount,
			usedAt:       new Date(),
		})
		return true
	} catch (err) {
		// Duplicate key error (code 11000) → tx hash already consumed
		if (err instanceof MongoServerError && err.code === 11000) return false
		throw err
	}
}
