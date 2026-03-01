import { encodeAbiParameters, parseAbiParameters, keccak256, toHex, type Hex } from 'viem'

/**
 * ABI-encodes a generic CREHub workflow report for CREHubExecutor.onReport.
 *
 * Matches the decoder in CREHubExecutor.sol:
 *   abi.decode(report, (string workflowId, bytes32 resultHash))
 *
 * All CREHub workflows use this same generic payload format.
 * You should NOT need to modify this file — it works for any workflow.
 *
 * @param workflowId  Workflow identifier (e.g. "wf_my_workflow_01")
 * @param resultHash  keccak256 hash of the JSON-serialized workflow output
 */
export function encodeReport(workflowId: string, resultHash: Hex): Hex {
	return encodeAbiParameters(
		parseAbiParameters('string workflowId, bytes32 resultHash'),
		[workflowId, resultHash],
	)
}

/**
 * Computes the keccak256 hash of a workflow output object.
 * The output is JSON-serialized before hashing.
 */
export function hashOutput(output: unknown): Hex {
	return keccak256(toHex(JSON.stringify(output)))
}
