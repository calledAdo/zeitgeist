// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Zeit} from "./Zeit.sol";
import {CategoryVoter} from "./CategoryVoter.sol";

/// @notice Weekly ZEIT emissions: starts at `initialWeekly`, decays 1% per week; 5% to the team, the rest
///         to the CategoryVoter, which splits it by the previous week's category votes.
/// @dev Spec v4 caps emissions at trailing fees in ZEIT terms; that needs a ZEIT price (Kuru TWAP) and is
///      not implemented yet — see the timeline.
contract Minter {
    error TooEarly();

    uint256 public constant WEEK = 1 weeks;
    uint256 public constant DECAY_BPS = 9_900; // ×0.99 per week
    uint256 public constant TEAM_BPS = 500;

    Zeit public immutable zeit;
    CategoryVoter public immutable voter;
    address public immutable team;
    uint256 public weekly;
    uint256 public lastEpoch;

    event Emitted(uint256 indexed epoch, uint256 toVoter, uint256 toTeam);

    constructor(address zeit_, address voter_, address team_, uint256 initialWeekly) {
        zeit = Zeit(zeit_);
        voter = CategoryVoter(voter_);
        team = team_;
        weekly = initialWeekly;
        lastEpoch = block.timestamp / WEEK;
    }

    /// @notice Permissionless; call once after each Thursday 00:00 UTC flip.
    function updatePeriod() external returns (uint256 emitted) {
        uint256 e = block.timestamp / WEEK;
        if (e <= lastEpoch) revert TooEarly();
        lastEpoch = e;
        emitted = weekly;
        weekly = weekly * DECAY_BPS / 10_000;
        uint256 toTeam = emitted * TEAM_BPS / 10_000;
        uint256 toVoter = emitted - toTeam;
        zeit.mint(team, toTeam);
        zeit.mint(address(this), toVoter);
        zeit.transfer(address(voter), toVoter); // voter forwards to gauges inside distribute()
        voter.distribute(toVoter);
        emit Emitted(e, toVoter, toTeam);
    }
}
