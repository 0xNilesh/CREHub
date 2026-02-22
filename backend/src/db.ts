/**
 * MongoDB connection and workflow CRUD.
 *
 * pricePerInvocation and registeredAt are stored as strings
 * because BSON has no native bigint type.
 */
import { MongoClient, type Collection, type Db } from 'mongodb'
import type { WorkflowListing } from './types'
import type { Hex } from 'viem'

const DB_NAME = 'crehub'
const COLLECTION = 'workflows'

export interface WorkflowDocument {
	workflowId: string
	creatorAddress: string
	pricePerInvocation: string // bigint stored as string
	description: string
	detailedDescription: string
	category: string
	active: boolean
	registeredAt: string // unix timestamp stored as string
	inputs: Array<{ name: string; fieldType: string; description: string; required: boolean }>
	outputs: Array<{ name: string; fieldType: string; description: string; required: boolean }>
}

let _client: MongoClient | undefined
let _db: Db | undefined

const col = (): Collection<WorkflowDocument> => {
	if (!_db) throw new Error('DB not connected — call connectDb() first')
	return _db.collection<WorkflowDocument>(COLLECTION)
}

// ─── Connection ───────────────────────────────────────────────────────────────

export const connectDb = async (): Promise<void> => {
	const uri = process.env.MONGODB_URI
	if (!uri) throw new Error('MONGODB_URI environment variable is not set')

	_client = new MongoClient(uri)
	await _client.connect()
	_db = _client.db(DB_NAME)
	await col().createIndex({ workflowId: 1 }, { unique: true })
	console.log('[db] Connected to MongoDB')
}

export const closeDb = async (): Promise<void> => {
	await _client?.close()
}

// ─── Conversions ──────────────────────────────────────────────────────────────

export const toDocument = (listing: WorkflowListing): WorkflowDocument => ({
	workflowId: listing.metadata.workflowId,
	creatorAddress: listing.metadata.creatorAddress,
	pricePerInvocation: listing.metadata.pricePerInvocation.toString(),
	description: listing.metadata.description,
	detailedDescription: listing.metadata.detailedDescription,
	category: listing.metadata.category,
	active: listing.metadata.active,
	registeredAt: listing.metadata.registeredAt.toString(),
	inputs: listing.inputs,
	outputs: listing.outputs,
})

export const fromDocument = (doc: WorkflowDocument): WorkflowListing => ({
	metadata: {
		workflowId: doc.workflowId,
		creatorAddress: doc.creatorAddress as Hex,
		pricePerInvocation: BigInt(doc.pricePerInvocation),
		description: doc.description,
		detailedDescription: doc.detailedDescription,
		category: doc.category,
		active: doc.active,
		registeredAt: BigInt(doc.registeredAt),
	},
	inputs: doc.inputs,
	outputs: doc.outputs,
})

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const upsertWorkflow = async (listing: WorkflowListing): Promise<void> => {
	const doc = toDocument(listing)
	await col().updateOne({ workflowId: doc.workflowId }, { $set: doc }, { upsert: true })
}

export const updateWorkflowStatus = async (
	workflowId: string,
	pricePerInvocation: bigint,
	active: boolean,
): Promise<void> => {
	await col().updateOne(
		{ workflowId },
		{ $set: { pricePerInvocation: pricePerInvocation.toString(), active } },
	)
}

export const getAllActive = async (): Promise<WorkflowListing[]> => {
	const docs = await col().find({ active: true }).toArray()
	return docs.map(fromDocument)
}

export const getOne = async (workflowId: string): Promise<WorkflowListing | null> => {
	const doc = await col().findOne({ workflowId })
	return doc ? fromDocument(doc) : null
}
