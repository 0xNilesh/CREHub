// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title CREHubExecutor
 * @notice Receives signed CRE reports from the Chainlink CRE Forwarder and
 *         stores workflow result hashes on Ethereum Sepolia.
 *
 * Architecture:
 *   CRE Workflow (TypeScript, DON)
 *       │  EVMClient.writeReport(receiver=CREHubExecutor)
 *       ▼
 *   CRE Forwarder  ← Chainlink-provided, fixed per chain
 *       │  forwarder.call → executor.onReport(metadata, report)
 *       ▼
 *   CREHubExecutor  ← this contract
 *
 * @dev Only the CRE Forwarder address (set at construction) may call onReport.
 *      The report bytes are ABI-decoded as:
 *        (string workflowId, bytes32 resultHash)
 *      where resultHash = keccak256(JSON.stringify(output)).
 *      All CREHub workflows use this generic payload format.
 */
contract CREHubExecutor {
    // ─── Immutable ────────────────────────────────────────────────────────────

    /// @notice Chainlink-provided CRE Forwarder — the only allowed caller.
    address public immutable CRE_FORWARDER;

    // ─── Storage ──────────────────────────────────────────────────────────────

    struct Result {
        bytes32 resultHash;
        uint256 timestamp;
    }

    /// @notice Latest recorded result per workflow ID string.
    mapping(string => Result) public latest;

    // ─── Events ───────────────────────────────────────────────────────────────

    event WorkflowResultRecorded(
        string  workflowId,
        bytes32 resultHash,
        uint256 timestamp
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address forwarder) {
        require(forwarder != address(0), "CREHubExecutor: zero forwarder");
        CRE_FORWARDER = forwarder;
    }

    // ─── CRE entry-point ──────────────────────────────────────────────────────

    /**
     * @notice Called by the CRE Forwarder after the DON reaches consensus.
     * @param  report  ABI-encoded (string workflowId, bytes32 resultHash)
     */
    function onReport(bytes calldata /*metadata*/, bytes calldata report) external {
        require(msg.sender == CRE_FORWARDER, "CREHubExecutor: only forwarder");

        (
            string  memory workflowId,
            bytes32        resultHash
        ) = abi.decode(report, (string, bytes32));

        latest[workflowId] = Result({
            resultHash: resultHash,
            timestamp:  block.timestamp
        });

        emit WorkflowResultRecorded(workflowId, resultHash, block.timestamp);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the latest recorded result for a workflow.
     * @return resultHash keccak256 of the workflow JSON output
     * @return timestamp  unix seconds of last update
     */
    function getLatest(string calldata workflowId)
        external view
        returns (bytes32 resultHash, uint256 timestamp)
    {
        Result memory r = latest[workflowId];
        return (r.resultHash, r.timestamp);
    }
}
