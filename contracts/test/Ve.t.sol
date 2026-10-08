// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./CategoryMarket.t.sol";
import {CategoryMarket} from "../src/CategoryMarket.sol";
import {Zeit} from "../src/Zeit.sol";
import {VotingEscrow} from "../src/VotingEscrow.sol";
import {CategoryVoter} from "../src/CategoryVoter.sol";
import {Minter} from "../src/Minter.sol";
import {EntityGauge} from "../src/EntityGauge.sol";
import {EntityToken} from "../src/EntityToken.sol";

contract VeTest is Base {
    Zeit zeit;
    VotingEscrow ve;
    CategoryVoter voter;
    Minter minter;
    EntityGauge gauge;
    EntityGauge gauge2;
    CategoryMarket market2;
    address team = makeAddr("team");
    bytes32 constant CAT2 = "tech_companies";

    function setUp() public override {
        super.setUp();
        zeit = new Zeit(address(this), address(this), 100_000_000e18);
        ve = new VotingEscrow(address(zeit));
        voter = new CategoryVoter(address(this), address(ve), address(zeit), treasury);
        minter = new Minter(address(zeit), address(voter), team, 1_500_000e18);
        zeit.setMinter(address(minter));
        voter.setMinter(address(minter));
        gauge = new EntityGauge(address(market), address(zeit), address(voter));
        voter.addCategory(CAT, address(gauge));
        market2 = new CategoryMarket(CategoryMarket.Config({
            asset: address(usdc), oracle: address(oracle), categoryId: CAT2, epochLength: 8 hours,
            k: 0.15e18, cap: 0.08e18, feeBps: 50, maxOracleAge: 2 hours, feeSink: sink, owner: address(this)
        }));
        usdc.approve(address(market2), type(uint256).max);
        market2.list("E", "E", 25_000e6, 100_000e18, treasury);
        gauge2 = new EntityGauge(address(market2), address(zeit), address(voter));
        voter.addCategory(CAT2, address(gauge2));
        market.setVoter(address(voter));
        // alice and bob lock ZEIT
        zeit.transfer(alice, 1_000e18);
        zeit.transfer(bob, 1_000e18);
        vm.prank(alice); zeit.approve(address(ve), type(uint256).max);
        vm.prank(bob); zeit.approve(address(ve), type(uint256).max);
        vm.prank(alice); ve.createLock(1_000e18, 52 weeks);
        vm.prank(bob); ve.createLock(1_000e18, 26 weeks);
    }

    function _cats(bytes32 a) internal pure returns (bytes32[] memory c) { c = new bytes32[](1); c[0] = a; }
    function _w(uint256 a) internal pure returns (uint256[] memory w) { w = new uint256[](1); w[0] = a; }

    function test_votingPowerDecaysLinearly() public {
        uint256 p0 = ve.votingPower(alice);
        assertApproxEqRel(p0, 1_000e18, 0.03e18); // ~full (end rounded down to a week)
        vm.warp(block.timestamp + 26 weeks);
        assertApproxEqRel(ve.votingPower(alice), p0 / 2, 0.03e18);
        assertGt(p0, ve.votingPower(bob) + 400e18); // shorter lock, less power
    }

    function test_feesFlowToCategoryVotersProRata() public {
        vm.prank(alice); voter.vote(_cats(CAT), _w(1));
        vm.prank(bob); voter.vote(_cats(CAT), _w(1));
        uint256 e = voter.epochNow();
        vm.prank(alice); market.buy(0, 10_000e6, 0, alice); // $50 fee
        market.collectFees();                                // $35 to voters, $15 to treasury sink
        assertEq(usdc.balanceOf(sink), 15e6);
        vm.expectRevert(CategoryVoter.EpochNotOver.selector);
        vm.prank(alice); voter.claim(e, CAT, address(usdc));
        vm.warp((e + 1) * 1 weeks + 1);
        vm.prank(alice); uint256 a = voter.claim(e, CAT, address(usdc));
        vm.prank(bob); uint256 b = voter.claim(e, CAT, address(usdc));
        assertApproxEqAbs(a + b, 35e6, 2);
        assertGt(a, b); // alice's 52-week lock outvotes bob's 26-week lock
        vm.expectRevert(CategoryVoter.AlreadyClaimed.selector);
        vm.prank(alice); voter.claim(e, CAT, address(usdc));
    }

    function test_revoteReplaces() public {
        vm.prank(alice); voter.vote(_cats(CAT), _w(1));
        uint256 e = voter.epochNow();
        uint256 v = voter.votes(e, CAT);
        vm.prank(alice); voter.vote(_cats(CAT2), _w(1));
        assertEq(voter.votes(e, CAT), 0);
        assertEq(voter.votes(e, CAT2), v);
        assertEq(voter.totalVotes(e), v);
    }

    function test_noVotesInLastHour() public {
        uint256 e = voter.epochNow();
        vm.warp((e + 1) * 1 weeks - 30 minutes);
        vm.expectRevert(CategoryVoter.VotingClosed.selector);
        vm.prank(alice); voter.vote(_cats(CAT), _w(1));
    }

    function test_emissionsSplitByVotesThenByReserve() public {
        // alice votes all-in on geopolitics; bob splits 1:1
        vm.prank(alice); voter.vote(_cats(CAT), _w(1));
        bytes32[] memory both = new bytes32[](2); both[0] = CAT; both[1] = CAT2;
        uint256[] memory ww = new uint256[](2); ww[0] = 1; ww[1] = 1;
        vm.prank(bob); voter.vote(both, ww);
        uint256 e = voter.epochNow();
        uint256 vg = voter.votes(e, CAT);
        uint256 vt = voter.votes(e, CAT2);

        // holders stake in geopolitics entities 0 and 1; entity 0 has a bigger reserve
        vm.prank(alice); uint256 s0 = market.buy(0, 75_000e6, 0, alice);   // reserve 0 ≈ 25k + 74.6k
        vm.prank(bob); uint256 s1 = market.buy(1, 1_000e6, 0, bob);        // reserve 1 ≈ 26k
        vm.startPrank(alice);
        (address t0,,) = market.entity(0);
        EntityToken(t0).approve(address(gauge), s0);
        gauge.stake(0, s0);
        vm.stopPrank();
        vm.startPrank(bob);
        (address t1,,) = market.entity(1);
        EntityToken(t1).approve(address(gauge), s1);
        gauge.stake(1, s1);
        vm.stopPrank();

        vm.warp((e + 1) * 1 weeks + 1);
        minter.updatePeriod();
        uint256 toVoter = 1_500_000e18 * 95 / 100;
        assertEq(zeit.balanceOf(team), 1_500_000e18 * 5 / 100);
        uint256 gGeo = toVoter * vg / (vg + vt);
        assertApproxEqAbs(zeit.balanceOf(address(gauge)), gGeo, 1e6);
        // tech gauge has no stakers: its share is carried, not lost
        assertApproxEqAbs(gauge2.pending(), toVoter - gGeo, 1e6);

        vm.warp(block.timestamp + 1 weeks);
        vm.prank(alice); uint256 ra = gauge.getReward(0);
        vm.prank(bob); uint256 rb = gauge.getReward(1);
        // split by reserve share (≈ 99.6k : 26k), i.e. per dollar held, not per vote on an entity
        (, uint256 r0,) = market.entity(0);
        (, uint256 r1,) = market.entity(1);
        assertApproxEqRel(ra * 1e18 / rb, r0 * 1e18 / r1, 0.001e18);
        assertApproxEqRel(ra + rb, gGeo, 0.0001e18);
        // next week's emission is 1% lower
        assertEq(minter.weekly(), 1_500_000e18 * 99 / 100);
    }

    function test_bribesFromAnyone() public {
        vm.prank(alice); voter.vote(_cats(CAT2), _w(1));
        uint256 e = voter.epochNow();
        address fanDao = makeAddr("fanDao");
        usdc.mint(fanDao, 5_000e6);
        vm.startPrank(fanDao);
        usdc.approve(address(voter), 5_000e6);
        voter.notifyReward(CAT2, address(usdc), 5_000e6);
        vm.stopPrank();
        vm.warp((e + 1) * 1 weeks + 1);
        vm.prank(alice); assertEq(voter.claim(e, CAT2, address(usdc)), 5_000e6);
    }

    function test_unvotedRewardsRollOver() public {
        uint256 e = voter.epochNow();
        usdc.mint(address(this), 100e6);
        usdc.approve(address(voter), 100e6);
        voter.notifyReward(CAT2, address(usdc), 100e6);
        vm.warp((e + 1) * 1 weeks + 1);
        voter.rollover(e, CAT2, address(usdc));
        assertEq(voter.rewards(e + 1, CAT2, address(usdc)), 100e6);
    }
}
