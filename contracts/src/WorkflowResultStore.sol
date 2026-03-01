// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title WorkflowResultStore
 * @notice On-chain proof of CRE workflow execution.
 *
 * Every time the CREHub gateway successfully simulates a workflow it calls
 * storeResult(), writing a keccak256 hash of the JSON output on-chain.
 * This gives a verifiable Ethereum Sepolia tx hash for every execution,
 * even before full DON deploy access is available.
 *
 * Anyone can verify: keccak256(resultJson) == latest[workflowId].resultHash
 */
contract WorkflowResultStore {
    // ─── Events ──────────────────────────────────────────────────────────────

    event ResultStored(
        string  indexed workflowId,
        bytes32         resultHash,
        address indexed executor,
        uint256         timestamp
    );

    // ─── Storage ─────────────────────────────────────────────────────────────

    struct StoredResult {
        bytes32 resultHash;
        uint256 timestamp;
        address executor;
    }

    /// @notice Latest result per workflowId
    mapping(string => StoredResult) public latest;

    // ─── Write ───────────────────────────────────────────────────────────────

    /**
     * @param workflowId  CREHub workflow identifier (e.g. "wf_hello_world_01")
     * @param resultHash  keccak256 of the JSON output string from cre workflow simulate
     */
    function storeResult(string calldata workflowId, bytes32 resultHash) external {
        latest[workflowId] = StoredResult({
            resultHash: resultHash,
            timestamp:  block.timestamp,
            executor:   msg.sender
        });
        emit ResultStored(workflowId, resultHash, msg.sender, block.timestamp);
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    function getLatest(string calldata workflowId)
        external view
        returns (bytes32 resultHash, uint256 timestamp, address executor)
    {
        StoredResult memory r = latest[workflowId];
        return (r.resultHash, r.timestamp, r.executor);
    }
}
