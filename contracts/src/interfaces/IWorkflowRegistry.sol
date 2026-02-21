// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IWorkflowRegistry {
    function recordExecution(
        bytes32 executionId,
        string calldata workflowId,
        address agentAddress
    ) external;
}
