// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SealedCalls} from "../src/SealedCalls.sol";

contract SealedCallsTest is Test {
    SealedCalls sc = new SealedCalls();
    address alice = makeAddr("alice");

    function test_sealThenReveal() public {
        vm.warp(1_790_000_000);
        vm.prank(alice);
        sc.seal(bytes16("call-1"), 72 hours, hex"deadbeef");
        (address caller, uint64 at, uint64 end, bool rev) = sc.calls(bytes16("call-1"));
        assertEq(caller, alice);
        assertEq(end, at + 72 hours);
        assertFalse(rev);
        vm.prank(alice);
        sc.reveal(bytes16("call-1"), bytes32(uint256(7)));
        (,,, rev) = sc.calls(bytes16("call-1"));
        assertTrue(rev);
    }

    function test_onlyCallerReveals_once() public {
        vm.prank(alice);
        sc.seal(bytes16("c"), 1 hours, hex"00");
        vm.expectRevert(SealedCalls.NotCaller.selector);
        sc.reveal(bytes16("c"), bytes32(0));
        vm.startPrank(alice);
        sc.reveal(bytes16("c"), bytes32(0));
        vm.expectRevert(SealedCalls.AlreadyRevealed.selector);
        sc.reveal(bytes16("c"), bytes32(0));
    }

    function test_noOverwrite_andBounds() public {
        vm.prank(alice);
        sc.seal(bytes16("c"), 1 hours, hex"00");
        vm.expectRevert(SealedCalls.Exists.selector);
        sc.seal(bytes16("c"), 1 hours, hex"00");
        vm.expectRevert(SealedCalls.BadHorizon.selector);
        sc.seal(bytes16("d"), 10 minutes, hex"00");
        vm.expectRevert(SealedCalls.TooLarge.selector);
        sc.seal(bytes16("e"), 1 hours, new bytes(1025));
    }
}
