// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorkflowRegistry} from "../src/WorkflowRegistry.sol";

contract WorkflowRegistryTest is Test {
    WorkflowRegistry public registry;

    address public owner   = address(this);
    address public creator = address(0xA1);
    address public agent   = address(0xB1);
    address public vault   = address(0xC1);

    WorkflowRegistry.WorkflowIOField[] internal emptyFields;

    WorkflowRegistry.WorkflowIOField[] internal sampleInputs;
    WorkflowRegistry.WorkflowIOField[] internal sampleOutputs;

    function setUp() public {
        registry = new WorkflowRegistry();
        registry.setSettlementVault(vault);

        sampleInputs.push(WorkflowRegistry.WorkflowIOField({
            name: "walletAddress",
            fieldType: "address",
            description: "Position owner",
            required: true
        }));

        sampleOutputs.push(WorkflowRegistry.WorkflowIOField({
            name: "healthFactor",
            fieldType: "number",
            description: "Health factor ratio",
            required: true
        }));
        sampleOutputs.push(WorkflowRegistry.WorkflowIOField({
            name: "riskLevel",
            fieldType: "string",
            description: "safe | warning | danger",
            required: true
        }));
    }

    // ─── listWorkflow ─────────────────────────────────────────────────────────

    function test_ListWorkflow_Succeeds() public {
        vm.prank(creator);
        registry.listWorkflow(
            "wf_hf_monitor_01",
            10_000,
            "Health factor monitor",
            "Detailed description",
            "defi",
            sampleInputs,
            sampleOutputs
        );

        (WorkflowRegistry.WorkflowMetadata memory meta,,) = registry.getWorkflow("wf_hf_monitor_01");
        assertEq(meta.workflowId, "wf_hf_monitor_01");
        assertEq(meta.creatorAddress, creator);
        assertEq(meta.pricePerInvocation, 10_000);
        assertTrue(meta.active);
    }

    function test_ListWorkflow_EmitsEvent() public {
        // Build expected metadata — registeredAt will be block.timestamp so skip data check
        WorkflowRegistry.WorkflowMetadata memory expectedMeta = WorkflowRegistry.WorkflowMetadata({
            workflowId: "wf_test",
            creatorAddress: creator,
            pricePerInvocation: 10_000,
            description: "desc",
            detailedDescription: "detail",
            category: "defi",
            active: true,
            registeredAt: block.timestamp
        });

        // topic1 = keccak256(workflowId) — skip (hash not predictable inline)
        // topic2 = creatorAddress         — check
        // checkData = false               — skip (registeredAt is block.timestamp, hard to match exactly)
        vm.expectEmit(false, true, false, false);
        emit WorkflowRegistry.WorkflowListed("wf_test", creator, expectedMeta, emptyFields, emptyFields);

        vm.prank(creator);
        registry.listWorkflow("wf_test", 10_000, "desc", "detail", "defi", emptyFields, emptyFields);
    }

    function test_ListWorkflow_Reverts_OnDuplicate() public {
        vm.prank(creator);
        registry.listWorkflow("wf_dup", 1000, "desc", "detail", "data", emptyFields, emptyFields);

        vm.expectRevert(abi.encodeWithSelector(WorkflowRegistry.WorkflowAlreadyExists.selector, "wf_dup"));
        vm.prank(creator);
        registry.listWorkflow("wf_dup", 1000, "desc2", "detail2", "data", emptyFields, emptyFields);
    }

    function test_GetWorkflow_Reverts_WhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(WorkflowRegistry.WorkflowNotFound.selector, "nonexistent"));
        registry.getWorkflow("nonexistent");
    }

    // ─── updateWorkflow ───────────────────────────────────────────────────────

    function test_UpdateWorkflow_ByCreator() public {
        vm.prank(creator);
        registry.listWorkflow("wf_upd", 5000, "desc", "detail", "compute", emptyFields, emptyFields);

        vm.prank(creator);
        registry.updateWorkflow("wf_upd", 20_000, false);

        (WorkflowRegistry.WorkflowMetadata memory meta,,) = registry.getWorkflow("wf_upd");
        assertEq(meta.pricePerInvocation, 20_000);
        assertFalse(meta.active);
    }

    function test_UpdateWorkflow_EmitsEvent() public {
        vm.prank(creator);
        registry.listWorkflow("wf_evt", 5000, "desc", "detail", "compute", emptyFields, emptyFields);

        // topic1 = creatorAddress (only indexed param) — check
        // checkData = true: workflowId (string), pricePerInvocation, active are all non-indexed
        vm.expectEmit(true, false, false, true);
        emit WorkflowRegistry.WorkflowUpdated("wf_evt", creator, 20_000, false);

        vm.prank(creator);
        registry.updateWorkflow("wf_evt", 20_000, false);
    }

    function test_UpdateWorkflow_Reverts_IfNotCreator() public {
        vm.prank(creator);
        registry.listWorkflow("wf_auth", 1000, "desc", "detail", "defi", emptyFields, emptyFields);

        vm.expectRevert(abi.encodeWithSelector(WorkflowRegistry.NotCreator.selector, "wf_auth"));
        vm.prank(address(0xDEAD));
        registry.updateWorkflow("wf_auth", 9999, true);
    }

    // ─── recordExecution (called by vault) ────────────────────────────────────

    function test_RecordExecution_ByVault() public {
        vm.prank(creator);
        registry.listWorkflow("wf_exec", 1000, "desc", "detail", "monitoring", emptyFields, emptyFields);

        bytes32 execId = keccak256("exec1");
        vm.prank(vault);
        registry.recordExecution(execId, "wf_exec", agent);

        bytes32[] memory wfIds = registry.getWorkflowExecutionIds("wf_exec", 0, 10);
        assertEq(wfIds.length, 1);
        assertEq(wfIds[0], execId);

        bytes32[] memory agentIds = registry.getAgentExecutionIds(agent, 0, 10);
        assertEq(agentIds.length, 1);
        assertEq(agentIds[0], execId);

        assertEq(registry.totalExecutions(), 1);
    }

    function test_RecordExecution_Reverts_IfNotVault() public {
        vm.expectRevert(WorkflowRegistry.NotSettlementVault.selector);
        vm.prank(address(0xBAD));
        registry.recordExecution(keccak256("x"), "wf_1", agent);
    }

    // ─── enumeration ──────────────────────────────────────────────────────────

    function test_GetActiveWorkflows_Paginated() public {
        vm.startPrank(creator);
        registry.listWorkflow("wf_1", 1000, "a", "b", "defi", emptyFields, emptyFields);
        registry.listWorkflow("wf_2", 2000, "c", "d", "data", emptyFields, emptyFields);
        registry.listWorkflow("wf_3", 3000, "e", "f", "compute", emptyFields, emptyFields);
        vm.stopPrank();

        WorkflowRegistry.WorkflowMetadata[] memory page = registry.getActiveWorkflows(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].workflowId, "wf_1");
        assertEq(page[1].workflowId, "wf_2");

        WorkflowRegistry.WorkflowMetadata[] memory page2 = registry.getActiveWorkflows(2, 10);
        assertEq(page2.length, 1);
        assertEq(page2[0].workflowId, "wf_3");
    }

    function test_TotalWorkflows() public {
        assertEq(registry.totalWorkflows(), 0);

        vm.prank(creator);
        registry.listWorkflow("wf_cnt", 1000, "a", "b", "defi", emptyFields, emptyFields);

        assertEq(registry.totalWorkflows(), 1);
    }

    function test_SetSettlementVault_Reverts_IfNotOwner() public {
        vm.expectRevert(WorkflowRegistry.NotOwner.selector);
        vm.prank(address(0xBAD));
        registry.setSettlementVault(address(0x1234));
    }
}
