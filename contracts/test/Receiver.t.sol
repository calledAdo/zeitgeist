// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./CategoryMarket.t.sol";
import {ZeitgeistReceiver} from "../src/ZeitgeistReceiver.sol";

contract ReceiverTest is Base {
    ZeitgeistReceiver rx;
    address fwd = makeAddr("forwarder");
    address wfOwner = makeAddr("workflowOwner");

    function setUp() public override {
        super.setUp();
        rx = new ZeitgeistReceiver(address(this), address(oracle), fwd);
        oracle.setReporter(address(rx), true);
        rx.setMarket(CAT, address(market));
        rx.setWorkflow(wfOwner, bytes32(0));
    }

    function _meta(address owner_) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32("wf-id"), bytes10("zeitgeist"), owner_);
    }

    function _report(uint64 asOf) internal pure returns (bytes memory) {
        ZeitgeistReceiver.CategoryReport[] memory r = new ZeitgeistReceiver.CategoryReport[](1);
        uint256[] memory t = new uint256[](4);
        (t[0], t[1], t[2], t[3]) = (0.4e18, 0.2e18, 0.2e18, 0.2e18);
        r[0] = ZeitgeistReceiver.CategoryReport(CAT, asOf, keccak256("inputs"), t);
        return abi.encode(r);
    }

    function test_reportPostsAndFunds() public {
        _nextEpoch();
        uint256 p0 = market.price(0);
        vm.prank(fwd);
        rx.onReport(_meta(wfOwner), _report(uint64(block.timestamp)));
        assertEq(oracle.latest(CAT).targets[0], 0.4e18);
        assertEq(market.lastFundedEpoch(), market.currentEpoch());
        assertGt(market.price(0), p0); // hot entity gained reserve
    }

    function test_onlyForwarder() public {
        vm.expectRevert(ZeitgeistReceiver.NotForwarder.selector);
        rx.onReport(_meta(wfOwner), _report(uint64(block.timestamp)));
    }

    function test_wrongWorkflowOwnerRejected() public {
        vm.prank(fwd);
        vm.expectRevert(ZeitgeistReceiver.WrongWorkflow.selector);
        rx.onReport(_meta(makeAddr("mallory")), _report(uint64(block.timestamp)));
    }

    function test_notDueStillPosts() public {
        _nextEpoch();
        vm.prank(fwd);
        rx.onReport(_meta(wfOwner), _report(uint64(block.timestamp)));
        // same epoch again: funding is skipped, the newer post still lands
        vm.warp(block.timestamp + 60);
        vm.prank(fwd);
        rx.onReport(_meta(wfOwner), _report(uint64(block.timestamp)));
        assertEq(oracle.latest(CAT).asOf, uint64(block.timestamp));
    }
}
