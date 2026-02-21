// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {IWorkflowRegistry} from "./interfaces/IWorkflowRegistry.sol";

/**
 * @title SettlementVault
 * @notice Escrow / settlement contract for CREHub workflow executions.
 *
 * Flow (demo mode — gateway holds USDC):
 *   1. Agent sends USDC directly to PLATFORM_WALLET (gateway) via x402.
 *   2. Gateway calls createEscrow() — books the pending execution on-chain.
 *   3. Gateway runs `cre workflow simulate`.
 *   4. Gateway calls settleSuccess() or settleFailure().
 *      → gateway must have approved this contract to spend USDC on its behalf.
 *
 * Fee split:
 *   Success → 90% creator, 10% treasury
 *   Failure → 99% agent refund, 1% treasury
 *
 * Stats are tracked per-workflow directly in this contract to avoid
 * cross-contract storage reads.
 */
contract SettlementVault {
    // ─── Structs ──────────────────────────────────────────────────────────────

    enum ExecutionStatus { Pending, Success, Failure }

    struct ExecutionRecord {
        bytes32         executionId;
        string          workflowId;
        address         agentAddress;
        address         creatorAddress;
        uint256         pricePaid;
        uint256         creatorPayout;
        uint256         protocolFee;
        uint256         agentRefund;
        string          inputsJson;
        string          outputsJson;
        string          errorMessage;
        ExecutionStatus status;
        uint256         triggeredAt;
        uint256         settledAt;
    }

    struct WorkflowStats {
        uint256 totalRuns;
        uint256 successRuns;
        uint256 totalVolume; // sum of pricePaid for all runs
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public owner;
    address public gatewayAddress;
    address public treasury;
    IERC20  public usdc;
    IWorkflowRegistry public registry;

    mapping(bytes32 => ExecutionRecord) public executions;
    bytes32[] private _executionIds;

    // per-workflow stats (updated on settle)
    mapping(string => WorkflowStats) private _workflowStats;

    uint256 private _nonce;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ExecutionTriggered(
        bytes32 indexed executionId,
        string  indexed workflowId,
        address indexed agentAddress,
        address         creatorAddress,
        uint256         pricePaid,
        string          inputsJson,
        uint256         triggeredAt
    );

    event ExecutionSettled(
        bytes32 indexed executionId,
        string  indexed workflowId,
        address indexed agentAddress,
        address         creatorAddress,
        uint256         pricePaid,
        uint256         creatorPayout,
        uint256         protocolFee,
        uint256         agentRefund,
        bool            success,
        string          outputsJson,
        string          errorMessage,
        uint256         settledAt
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotGateway();
    error ExecutionNotFound(bytes32 executionId);
    error ExecutionAlreadySettled(bytes32 executionId);
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc, address _treasury, address _registry) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
        treasury = _treasury;
        registry = IWorkflowRegistry(_registry);
    }

    // ─── Owner config ─────────────────────────────────────────────────────────

    function setGateway(address gateway) external {
        if (msg.sender != owner) revert NotOwner();
        gatewayAddress = gateway;
    }

    function setTreasury(address newTreasury) external {
        if (msg.sender != owner) revert NotOwner();
        treasury = newTreasury;
    }

    // ─── Gateway: createEscrow ────────────────────────────────────────────────

    /**
     * @notice Book a pending execution. Called immediately after x402 payment
     *         verification. Emits ExecutionTriggered (explorer shows "pending").
     * @return executionId  Unique ID for this execution.
     */
    function createEscrow(
        string calldata workflowId,
        address agentAddress,
        address creatorAddress,
        uint256 amount,
        string calldata inputsJson
    ) external returns (bytes32 executionId) {
        if (msg.sender != gatewayAddress) revert NotGateway();

        executionId = keccak256(
            abi.encodePacked(workflowId, agentAddress, block.timestamp, _nonce++)
        );

        executions[executionId] = ExecutionRecord({
            executionId:    executionId,
            workflowId:     workflowId,
            agentAddress:   agentAddress,
            creatorAddress: creatorAddress,
            pricePaid:      amount,
            creatorPayout:  0,
            protocolFee:    0,
            agentRefund:    0,
            inputsJson:     inputsJson,
            outputsJson:    "",
            errorMessage:   "",
            status:         ExecutionStatus.Pending,
            triggeredAt:    block.timestamp,
            settledAt:      0
        });

        _executionIds.push(executionId);

        emit ExecutionTriggered(
            executionId, workflowId, agentAddress, creatorAddress,
            amount, inputsJson, block.timestamp
        );
    }

    // ─── Gateway: settle ──────────────────────────────────────────────────────

    /**
     * @notice Settle a successful execution: 90% to creator, 10% to treasury.
     *         Gateway wallet must have approved this contract to spend USDC.
     */
    function settleSuccess(
        bytes32 executionId,
        string calldata outputsJson
    ) external {
        if (msg.sender != gatewayAddress) revert NotGateway();

        ExecutionRecord storage rec = _assertPending(executionId);
        uint256 amount      = rec.pricePaid;
        uint256 creatorShare  = (amount * 90) / 100;
        uint256 protocolShare = amount - creatorShare; // 10%

        rec.creatorPayout = creatorShare;
        rec.protocolFee   = protocolShare;
        rec.outputsJson   = outputsJson;
        rec.status        = ExecutionStatus.Success;
        rec.settledAt     = block.timestamp;

        _workflowStats[rec.workflowId].totalRuns++;
        _workflowStats[rec.workflowId].successRuns++;
        _workflowStats[rec.workflowId].totalVolume += amount;

        _transferFrom(rec.creatorAddress, creatorShare);
        _transferFrom(treasury,           protocolShare);

        registry.recordExecution(executionId, rec.workflowId, rec.agentAddress);

        emit ExecutionSettled(
            executionId, rec.workflowId, rec.agentAddress, rec.creatorAddress,
            amount, creatorShare, protocolShare, 0,
            true, outputsJson, "", block.timestamp
        );
    }

    /**
     * @notice Settle a failed execution: 99% refund to agent, 1% to treasury.
     */
    function settleFailure(
        bytes32 executionId,
        string calldata errorMessage
    ) external {
        if (msg.sender != gatewayAddress) revert NotGateway();

        ExecutionRecord storage rec = _assertPending(executionId);
        uint256 amount        = rec.pricePaid;
        uint256 agentRefund   = (amount * 99) / 100;
        uint256 protocolShare = amount - agentRefund; // 1%

        rec.agentRefund   = agentRefund;
        rec.protocolFee   = protocolShare;
        rec.errorMessage  = errorMessage;
        rec.status        = ExecutionStatus.Failure;
        rec.settledAt     = block.timestamp;

        _workflowStats[rec.workflowId].totalRuns++;
        _workflowStats[rec.workflowId].totalVolume += amount;

        _transferFrom(rec.agentAddress, agentRefund);
        _transferFrom(treasury,         protocolShare);

        registry.recordExecution(executionId, rec.workflowId, rec.agentAddress);

        emit ExecutionSettled(
            executionId, rec.workflowId, rec.agentAddress, rec.creatorAddress,
            amount, 0, protocolShare, agentRefund,
            false, "", errorMessage, block.timestamp
        );
    }

    // ─── Read ─────────────────────────────────────────────────────────────────

    function getExecution(bytes32 executionId)
        external view returns (ExecutionRecord memory)
    {
        if (executions[executionId].triggeredAt == 0) revert ExecutionNotFound(executionId);
        return executions[executionId];
    }

    function getRecentExecutions(uint256 offset, uint256 limit)
        external view returns (ExecutionRecord[] memory page)
    {
        uint256 total = _executionIds.length;
        if (offset >= total) return new ExecutionRecord[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new ExecutionRecord[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = executions[_executionIds[offset + i]];
        }
    }

    function getTotalExecutions() external view returns (uint256) {
        return _executionIds.length;
    }

    function getWorkflowStats(string calldata workflowId)
        external view
        returns (uint256 totalRuns, uint256 successRuns, uint256 totalVolume, uint256 avgPrice)
    {
        WorkflowStats storage s = _workflowStats[workflowId];
        totalRuns   = s.totalRuns;
        successRuns = s.successRuns;
        totalVolume = s.totalVolume;
        avgPrice    = totalRuns > 0 ? totalVolume / totalRuns : 0;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _assertPending(bytes32 executionId)
        internal view returns (ExecutionRecord storage rec)
    {
        rec = executions[executionId];
        if (rec.triggeredAt == 0)                     revert ExecutionNotFound(executionId);
        if (rec.status != ExecutionStatus.Pending)    revert ExecutionAlreadySettled(executionId);
    }

    /// @dev Gateway pre-approves this contract; we pull USDC on its behalf.
    function _transferFrom(address to, uint256 amount) internal {
        if (amount == 0) return;
        bool ok = usdc.transferFrom(gatewayAddress, to, amount);
        if (!ok) revert TransferFailed();
    }
}
