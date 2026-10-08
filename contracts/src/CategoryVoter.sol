// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {VotingEscrow} from "./VotingEscrow.sol";

interface IGauge {
    function notifyRewardAmount(uint256 amount) external;
}

/// @title CategoryVoter
/// @notice Weekly category votes (epochs flip Thursday 00:00 UTC, unix-week aligned).
///         - Votes cast in epoch E earn the fees and bribes posted for those categories during E.
///         - Votes cast in epoch E split the emissions distributed at the flip into E+1.
///         Votes are per category, never per entity (spec v4): emissions then cannot push any single
///         pool above its attention target, so funding never drains them.
contract CategoryVoter is Ownable {
    using SafeTransferLib for address;

    error UnknownCategory();
    error NoPower();
    error VotingClosed();
    error BadInput();
    error EpochNotOver();
    error AlreadyClaimed();
    error OnlyMinter();

    uint256 public constant WEEK = 1 weeks;
    uint256 public constant VOTE_CUTOFF = 1 hours; // no votes in the last hour before the flip

    VotingEscrow public immutable ve;
    address public immutable zeit;
    address public minter;
    address public treasury;

    bytes32[] public categories;
    mapping(bytes32 => address) public gaugeOf;

    mapping(uint256 => mapping(bytes32 => uint256)) public votes;            // epoch => cat => votes
    mapping(uint256 => uint256) public totalVotes;                           // epoch => votes
    mapping(uint256 => mapping(address => mapping(bytes32 => uint256))) public userVotes;
    mapping(uint256 => mapping(address => bytes32[])) internal _userCats;

    mapping(uint256 => mapping(bytes32 => mapping(address => uint256))) public rewards; // epoch => cat => token => amount
    mapping(uint256 => mapping(bytes32 => mapping(address => mapping(address => bool)))) public claimed;

    event CategoryAdded(bytes32 indexed cat, address gauge);
    event Voted(uint256 indexed epoch, address indexed user, bytes32[] cats, uint256[] amounts);
    event RewardNotified(uint256 indexed epoch, bytes32 indexed cat, address token, uint256 amount);
    event Claimed(uint256 indexed epoch, bytes32 indexed cat, address indexed user, address token, uint256 amount);
    event Distributed(uint256 indexed epoch, uint256 amount);

    constructor(address owner_, address ve_, address zeit_, address treasury_) {
        _initializeOwner(owner_);
        ve = VotingEscrow(ve_);
        zeit = zeit_;
        treasury = treasury_;
    }

    function epochNow() public view returns (uint256) {
        return block.timestamp / WEEK;
    }

    function addCategory(bytes32 cat, address gauge) external onlyOwner {
        if (gaugeOf[cat] != address(0) || gauge == address(0)) revert BadInput();
        categories.push(cat);
        gaugeOf[cat] = gauge;
        emit CategoryAdded(cat, gauge);
    }

    function setMinter(address m) external onlyOwner {
        minter = m;
    }

    // ------------------------------------------------------------------ voting

    /// @notice Split your current veZEIT power across categories. Re-voting in the same epoch replaces your vote.
    function vote(bytes32[] calldata cats, uint256[] calldata weights) external {
        if (cats.length == 0 || cats.length != weights.length) revert BadInput();
        uint256 e = epochNow();
        if (block.timestamp >= (e + 1) * WEEK - VOTE_CUTOFF) revert VotingClosed();
        uint256 power = ve.votingPower(msg.sender);
        if (power == 0) revert NoPower();
        _reset(e, msg.sender);

        uint256 wsum;
        for (uint256 i; i < weights.length; ++i) wsum += weights[i];
        if (wsum == 0) revert BadInput();
        uint256[] memory amts = new uint256[](cats.length);
        for (uint256 i; i < cats.length; ++i) {
            if (gaugeOf[cats[i]] == address(0)) revert UnknownCategory();
            uint256 v = power * weights[i] / wsum;
            if (v == 0) continue;
            if (userVotes[e][msg.sender][cats[i]] == 0) _userCats[e][msg.sender].push(cats[i]);
            userVotes[e][msg.sender][cats[i]] += v;
            votes[e][cats[i]] += v;
            totalVotes[e] += v;
            amts[i] = v;
        }
        emit Voted(e, msg.sender, cats, amts);
    }

    function _reset(uint256 e, address user) internal {
        bytes32[] storage cs = _userCats[e][user];
        for (uint256 i; i < cs.length; ++i) {
            uint256 v = userVotes[e][user][cs[i]];
            votes[e][cs[i]] -= v;
            totalVotes[e] -= v;
            delete userVotes[e][user][cs[i]];
        }
        delete _userCats[e][user];
    }

    // ------------------------------------------------------------------ fees and bribes

    /// @notice Post fees (from a CategoryMarket) or bribes (from anyone) for a category's voters this epoch.
    function notifyReward(bytes32 cat, address token, uint256 amount) external {
        if (gaugeOf[cat] == address(0)) revert UnknownCategory();
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 e = epochNow();
        rewards[e][cat][token] += amount;
        emit RewardNotified(e, cat, token, amount);
    }

    function claimable(uint256 e, bytes32 cat, address token, address user) public view returns (uint256) {
        uint256 v = votes[e][cat];
        if (v == 0 || claimed[e][cat][token][user]) return 0;
        return rewards[e][cat][token] * userVotes[e][user][cat] / v;
    }

    function claim(uint256 e, bytes32 cat, address token) external returns (uint256 amt) {
        if (e >= epochNow()) revert EpochNotOver();
        if (claimed[e][cat][token][msg.sender]) revert AlreadyClaimed();
        amt = claimable(e, cat, token, msg.sender);
        claimed[e][cat][token][msg.sender] = true;
        if (amt != 0) token.safeTransfer(msg.sender, amt);
        emit Claimed(e, cat, msg.sender, token, amt);
    }

    /// @notice Rewards posted in an epoch nobody voted for roll into the current epoch.
    function rollover(uint256 e, bytes32 cat, address token) external {
        if (e >= epochNow() || votes[e][cat] != 0) revert BadInput();
        uint256 amt = rewards[e][cat][token];
        rewards[e][cat][token] = 0;
        rewards[epochNow()][cat][token] += amt;
    }

    // ------------------------------------------------------------------ emissions

    /// @notice Called by the Minter at the flip with that week's ZEIT; split by the previous epoch's votes.
    function distribute(uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        uint256 prev = epochNow() - 1;
        uint256 tv = totalVotes[prev];
        uint256 n = categories.length;
        uint256 sent;
        for (uint256 i; i < n; ++i) {
            bytes32 c = categories[i];
            uint256 share = tv == 0 ? amount / n : amount * votes[prev][c] / tv;
            if (share == 0) continue;
            address g = gaugeOf[c];
            zeit.safeApprove(g, share);
            IGauge(g).notifyRewardAmount(share);
            sent += share;
        }
        if (amount > sent) zeit.safeTransfer(treasury, amount - sent); // rounding dust
        emit Distributed(prev, amount);
    }

    function categoryCount() external view returns (uint256) {
        return categories.length;
    }
}
