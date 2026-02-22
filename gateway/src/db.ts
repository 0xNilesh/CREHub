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
import { MongoClient, type Collection, type Db } from 'mongodb'
import type { WorkflowMetadata } from './types'
import { WORKFLOW_DIRS } from './workflow-dirs'

const DB_NAME = 'crehub'
const COLLECTION = 'workflows'

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

// ─── Connection ───────────────────────────────────────────────────────────────

export const connectDb = async (): Promise<void> => {
	const uri = process.env.MONGODB_URI
	if (!uri) throw new Error('MONGODB_URI environment variable is not set')

	// Bun TLS bug: checkServerIdentity receives a null peer cert on Atlas SRV
	// connections, crashing node:tls. Supplying () => undefined skips the check.
	_client = new MongoClient(uri, { checkServerIdentity: () => undefined })
	await _client.connect()
	_db = _client.db(DB_NAME)
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
