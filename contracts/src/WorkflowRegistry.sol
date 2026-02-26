// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title WorkflowRegistry
 * @notice On-chain registry where CRE workflow creators list their workflows
 *         for discovery by AI agents. Stores metadata and indexes execution
 *         records written by SettlementVault after each settlement.
 *
 * Roles:
 *   - Creator: calls listWorkflow / updateWorkflow / deactivateWorkflow
 *   - SettlementVault: calls recordExecution (trusted, set by owner at deploy)
 *   - Anyone: reads listings and execution history
 */
contract WorkflowRegistry {
    // ─── Structs ─────────────────────────────────────────────────────────────

    struct WorkflowIOField {
        string name;
        string fieldType; // "string" | "number" | "boolean" | "address"
        string description;
        bool required;
    }

    struct WorkflowMetadata {
        string workflowId;
        address creatorAddress;
        uint256 pricePerInvocation; // USDC in 6-decimal units (e.g. 10000 = $0.01)
        string description;         // ≤ 160 chars
        string detailedDescription;
        string category;            // "defi" | "monitoring" | "data" | "compute"
        bool active;
        uint256 registeredAt;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    address public owner;
    address public settlementVault; // only this address may call recordExecution

    // workflowId → metadata
    mapping(string => WorkflowMetadata) private _workflows;
    // workflowId → input/output fields (stored separately to avoid deep nesting)
    mapping(string => WorkflowIOField[]) private _inputs;
    mapping(string => WorkflowIOField[]) private _outputs;

    // ordered list of all registered workflow IDs (for enumeration)
    string[] private _workflowIds;
    mapping(string => bool) private _exists;

    // execution index (executionId bytes32 arrays keyed by workflowId / agent)
    mapping(string => bytes32[]) public workflowExecutions;
    mapping(address => bytes32[]) public agentExecutions;
    bytes32[] private _allExecutions;

    // ─── Events ───────────────────────────────────────────────────────────────

    event WorkflowListed(
        string indexed workflowId,
        address indexed creatorAddress,
        WorkflowMetadata metadata,
        WorkflowIOField[] inputs,
        WorkflowIOField[] outputs
    );

    event WorkflowUpdated(
        string workflowId,
        address indexed creatorAddress,
        uint256 pricePerInvocation,
        bool active
    );

    event ExecutionRecorded(
        bytes32 indexed executionId,
        string indexed workflowId,
        address indexed agentAddress
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotSettlementVault();
    error WorkflowAlreadyExists(string workflowId);
    error WorkflowNotFound(string workflowId);
    error NotCreator(string workflowId);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function setSettlementVault(address vault) external {
        if (msg.sender != owner) revert NotOwner();
        settlementVault = vault;
    }

    // ─── Creator: list a workflow ─────────────────────────────────────────────

    /**
     * @notice Register a new workflow listing on behalf of any creator address.
     * @param workflowId  Unique ID (e.g. "wf_hf_monitor_01")
     * @param creatorAddress  Address to record as the workflow creator. Pass address(0) to use msg.sender.
     * @param price       USDC wei per invocation (6 decimals)
     * @param description Short description (≤ 160 chars)
     * @param detailedDescription  Full markdown description
     * @param category    "defi" | "monitoring" | "data" | "compute"
     * @param inputs      Array of input field definitions
     * @param outputs     Array of output field definitions
     */
    function listWorkflow(
        string calldata workflowId,
        address creatorAddress,
        uint256 price,
        string calldata description,
        string calldata detailedDescription,
        string calldata category,
        WorkflowIOField[] calldata inputs,
        WorkflowIOField[] calldata outputs
    ) external {
        if (_exists[workflowId]) revert WorkflowAlreadyExists(workflowId);

        address creator = creatorAddress == address(0) ? msg.sender : creatorAddress;

        _workflows[workflowId] = WorkflowMetadata({
            workflowId: workflowId,
            creatorAddress: creator,
            pricePerInvocation: price,
            description: description,
            detailedDescription: detailedDescription,
            category: category,
            active: true,
            registeredAt: block.timestamp
        });

        for (uint256 i = 0; i < inputs.length; i++) {
            _inputs[workflowId].push(inputs[i]);
        }
        for (uint256 i = 0; i < outputs.length; i++) {
            _outputs[workflowId].push(outputs[i]);
        }

        _workflowIds.push(workflowId);
        _exists[workflowId] = true;

        emit WorkflowListed(workflowId, creator, _workflows[workflowId], _inputs[workflowId], _outputs[workflowId]);
    }

    /**
     * @notice Creator updates price or active status.
     */
    function updateWorkflow(
        string calldata workflowId,
        uint256 newPrice,
        bool active
    ) external {
        if (!_exists[workflowId]) revert WorkflowNotFound(workflowId);
        if (_workflows[workflowId].creatorAddress != msg.sender) revert NotCreator(workflowId);

        _workflows[workflowId].pricePerInvocation = newPrice;
        _workflows[workflowId].active = active;

        emit WorkflowUpdated(workflowId, msg.sender, newPrice, active);
    }

    // ─── SettlementVault: record execution ────────────────────────────────────

    /**
     * @notice Called by SettlementVault after settlement to index the execution.
     */
    function recordExecution(
        bytes32 executionId,
        string calldata workflowId,
        address agentAddress
    ) external {
        if (msg.sender != settlementVault) revert NotSettlementVault();

        workflowExecutions[workflowId].push(executionId);
        agentExecutions[agentAddress].push(executionId);
        _allExecutions.push(executionId);

        emit ExecutionRecorded(executionId, workflowId, agentAddress);
    }

    // ─── Read: workflow metadata ───────────────────────────────────────────────

    function getWorkflow(string calldata workflowId)
        external
        view
        returns (WorkflowMetadata memory metadata, WorkflowIOField[] memory inputs, WorkflowIOField[] memory outputs)
    {
        if (!_exists[workflowId]) revert WorkflowNotFound(workflowId);
        return (_workflows[workflowId], _inputs[workflowId], _outputs[workflowId]);
    }

    function getAllWorkflowIds() external view returns (string[] memory) {
        return _workflowIds;
    }

    function getActiveWorkflows(uint256 offset, uint256 limit)
        external
        view
        returns (WorkflowMetadata[] memory page)
    {
        uint256 total = _workflowIds.length;
        if (offset >= total) return new WorkflowMetadata[](0);

        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 count = end - offset;
        page = new WorkflowMetadata[](count);

        for (uint256 i = 0; i < count; i++) {
            page[i] = _workflows[_workflowIds[offset + i]];
        }
    }

    function totalWorkflows() external view returns (uint256) {
        return _workflowIds.length;
    }

    // ─── Read: execution indexes ───────────────────────────────────────────────

    function getWorkflowExecutionIds(string calldata workflowId, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _sliceBytes32(workflowExecutions[workflowId], offset, limit);
    }

    function getAgentExecutionIds(address agent, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _sliceBytes32(agentExecutions[agent], offset, limit);
    }

    function getRecentExecutionIds(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory)
    {
        return _sliceBytes32(_allExecutions, offset, limit);
    }

    function totalExecutions() external view returns (uint256) {
        return _allExecutions.length;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _sliceBytes32(bytes32[] storage arr, uint256 offset, uint256 limit)
        internal
        view
        returns (bytes32[] memory result)
    {
        uint256 total = arr.length;
        if (offset >= total) return new bytes32[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        result = new bytes32[](end - offset);
        for (uint256 i = 0; i < result.length; i++) {
            result[i] = arr[offset + i];
        }
    }
}
