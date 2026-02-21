// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SettlementVault} from "../src/SettlementVault.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IWorkflowRegistry} from "../src/interfaces/IWorkflowRegistry.sol";

// ─── Minimal mock contracts ───────────────────────────────────────────────────

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract MockRegistry is IWorkflowRegistry {
    bytes32[] public recorded;

    function recordExecution(bytes32 executionId, string calldata, address) external {
        recorded.push(executionId);
    }
}

// ─── Test contract ────────────────────────────────────────────────────────────

contract SettlementVaultTest is Test {
    SettlementVault public vault;
    MockUSDC        public usdc;
    MockRegistry    public registry;

    address public owner    = address(this);
    address public gateway  = address(0xA1);
    address public agent    = address(0xB1);
    address public creator  = address(0xC1);
    address public treasury = address(0xD1);

    uint256 constant PRICE = 10_000; // $0.01 USDC

    function setUp() public {
        usdc     = new MockUSDC();
        registry = new MockRegistry();
        vault    = new SettlementVault(address(usdc), treasury, address(registry));
        vault.setGateway(gateway);

        // Gateway holds USDC and approves vault to spend it
        usdc.mint(gateway, 1_000_000);
        vm.prank(gateway);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── createEscrow ─────────────────────────────────────────────────────────

    function test_CreateEscrow_Succeeds() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, '{"walletAddress":"0x1"}');

        SettlementVault.ExecutionRecord memory rec = vault.getExecution(execId);
        assertEq(rec.workflowId, "wf_1");
        assertEq(rec.agentAddress, agent);
        assertEq(rec.creatorAddress, creator);
        assertEq(rec.pricePaid, PRICE);
        assertEq(uint8(rec.status), uint8(SettlementVault.ExecutionStatus.Pending));
        assertGt(rec.triggeredAt, 0);
    }

    function test_CreateEscrow_EmitsExecutionTriggered() public {
        vm.expectEmit(false, false, true, false);
        emit SettlementVault.ExecutionTriggered(bytes32(0), "wf_1", agent, creator, PRICE, "", 0);

        vm.prank(gateway);
        vault.createEscrow("wf_1", agent, creator, PRICE, "{}");
    }

    function test_CreateEscrow_Reverts_IfNotGateway() public {
        vm.expectRevert(SettlementVault.NotGateway.selector);
        vm.prank(address(0xBAD));
        vault.createEscrow("wf_1", agent, creator, PRICE, "{}");
    }

    function test_CreateEscrow_UniqueIds() public {
        vm.prank(gateway);
        bytes32 id1 = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.warp(block.timestamp + 1);
        vm.prank(gateway);
        bytes32 id2 = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        assertNotEq(id1, id2);
    }

    // ─── settleSuccess ────────────────────────────────────────────────────────

    function test_SettleSuccess_DistributesFees() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        uint256 creatorBefore  = usdc.balanceOf(creator);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(gateway);
        vault.settleSuccess(execId, '{"healthFactor":2.4}');

        // 90% to creator
        assertEq(usdc.balanceOf(creator),  creatorBefore  + (PRICE * 90 / 100));
        // 10% to treasury
        assertEq(usdc.balanceOf(treasury), treasuryBefore + (PRICE - PRICE * 90 / 100));
    }

    function test_SettleSuccess_UpdatesRecord() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleSuccess(execId, '{"result":true}');

        SettlementVault.ExecutionRecord memory rec = vault.getExecution(execId);
        assertEq(uint8(rec.status), uint8(SettlementVault.ExecutionStatus.Success));
        assertEq(rec.outputsJson, '{"result":true}');
        assertEq(rec.creatorPayout, PRICE * 90 / 100);
        assertGt(rec.settledAt, 0);
    }

    function test_SettleSuccess_RecordsInRegistry() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleSuccess(execId, "{}");

        assertEq(registry.recorded(0), execId);
    }

    function test_SettleSuccess_UpdatesStats() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleSuccess(execId, "{}");

        (uint256 totalRuns, uint256 successRuns, uint256 totalVolume, uint256 avgPrice) =
            vault.getWorkflowStats("wf_1");

        assertEq(totalRuns, 1);
        assertEq(successRuns, 1);
        assertEq(totalVolume, PRICE);
        assertEq(avgPrice, PRICE);
    }

    function test_SettleSuccess_Reverts_IfAlreadySettled() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleSuccess(execId, "{}");

        vm.expectRevert(abi.encodeWithSelector(SettlementVault.ExecutionAlreadySettled.selector, execId));
        vm.prank(gateway);
        vault.settleSuccess(execId, "{}");
    }

    function test_SettleSuccess_Reverts_IfNotGateway() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_1", agent, creator, PRICE, "{}");

        vm.expectRevert(SettlementVault.NotGateway.selector);
        vm.prank(address(0xBAD));
        vault.settleSuccess(execId, "{}");
    }

    // ─── settleFailure ────────────────────────────────────────────────────────

    function test_SettleFailure_DistributesFees() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_2", agent, creator, PRICE, "{}");

        uint256 agentBefore    = usdc.balanceOf(agent);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(gateway);
        vault.settleFailure(execId, "handler threw");

        // 99% refund to agent
        assertEq(usdc.balanceOf(agent),    agentBefore    + (PRICE * 99 / 100));
        // 1% ops fee to treasury
        assertEq(usdc.balanceOf(treasury), treasuryBefore + (PRICE - PRICE * 99 / 100));
    }

    function test_SettleFailure_UpdatesRecord() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_2", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleFailure(execId, "simulation error");

        SettlementVault.ExecutionRecord memory rec = vault.getExecution(execId);
        assertEq(uint8(rec.status), uint8(SettlementVault.ExecutionStatus.Failure));
        assertEq(rec.errorMessage, "simulation error");
        assertEq(rec.agentRefund, PRICE * 99 / 100);
        assertGt(rec.settledAt, 0);
    }

    function test_SettleFailure_DoesNotIncrementSuccessRuns() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_fail", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleFailure(execId, "err");

        (, uint256 successRuns,,) = vault.getWorkflowStats("wf_fail");
        assertEq(successRuns, 0);
    }

    function test_SettleFailure_Reverts_IfAlreadySettled() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_2", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleFailure(execId, "err");

        vm.expectRevert(abi.encodeWithSelector(SettlementVault.ExecutionAlreadySettled.selector, execId));
        vm.prank(gateway);
        vault.settleFailure(execId, "err2");
    }

    // ─── cannot mix settle directions ────────────────────────────────────────

    function test_CannotSettleFailureAfterSuccess() public {
        vm.prank(gateway);
        bytes32 execId = vault.createEscrow("wf_3", agent, creator, PRICE, "{}");

        vm.prank(gateway);
        vault.settleSuccess(execId, "{}");

        vm.expectRevert(abi.encodeWithSelector(SettlementVault.ExecutionAlreadySettled.selector, execId));
        vm.prank(gateway);
        vault.settleFailure(execId, "oops");
    }

    // ─── getRecentExecutions ──────────────────────────────────────────────────

    function test_GetRecentExecutions_Paginated() public {
        vm.startPrank(gateway);
        vault.createEscrow("wf_1", agent, creator, PRICE, "{}");
        vault.createEscrow("wf_2", agent, creator, PRICE, "{}");
        vault.createEscrow("wf_3", agent, creator, PRICE, "{}");
        vm.stopPrank();

        assertEq(vault.getTotalExecutions(), 3);

        SettlementVault.ExecutionRecord[] memory page = vault.getRecentExecutions(0, 2);
        assertEq(page.length, 2);

        SettlementVault.ExecutionRecord[] memory page2 = vault.getRecentExecutions(2, 10);
        assertEq(page2.length, 1);
    }

    // ─── config ───────────────────────────────────────────────────────────────

    function test_SetGateway_Reverts_IfNotOwner() public {
        vm.expectRevert(SettlementVault.NotOwner.selector);
        vm.prank(address(0xBAD));
        vault.setGateway(address(0x1));
    }

    function test_SetTreasury_Reverts_IfNotOwner() public {
        vm.expectRevert(SettlementVault.NotOwner.selector);
        vm.prank(address(0xBAD));
        vault.setTreasury(address(0x1));
    }

    function test_GetExecution_Reverts_WhenNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(SettlementVault.ExecutionNotFound.selector, bytes32(0)));
        vault.getExecution(bytes32(0));
    }
}
