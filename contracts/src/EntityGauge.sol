// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {CategoryMarket} from "./CategoryMarket.sol";

/// @title EntityGauge
/// @notice One per category. Holders stake their entity shares here to earn ZEIT. Each weekly emission
///         is split across entities by their share of the category's reserves at that moment, so a dollar
///         held in any entity earns the same rate; within an entity it streams by token-seconds over a week.
contract EntityGauge is ReentrancyGuard {
    using SafeTransferLib for address;

    error OnlyVoter();
    error ZeroAmount();

    uint256 public constant DURATION = 1 weeks;

    CategoryMarket public immutable market;
    address public immutable zeit;
    address public immutable voter;

    struct Pool {
        uint256 totalStaked;
        uint256 rewardRate;          // ZEIT per second (1e18-scaled numerator kept in rewardPerTokenStored math)
        uint256 periodFinish;
        uint256 lastUpdate;
        uint256 rewardPerTokenStored;
    }

    mapping(uint256 => Pool) public pools;
    uint256 public pending; // emissions not yet streamed (no stakers at notify time, rounding dust)
    mapping(uint256 => mapping(address => uint256)) public staked;
    mapping(uint256 => mapping(address => uint256)) public paidPerToken;
    mapping(uint256 => mapping(address => uint256)) public owed;

    event Staked(uint256 indexed i, address indexed user, uint256 amount);
    event Withdrawn(uint256 indexed i, address indexed user, uint256 amount);
    event RewardPaid(uint256 indexed i, address indexed user, uint256 amount);
    event Notified(uint256 total);

    constructor(address market_, address zeit_, address voter_) {
        market = CategoryMarket(market_);
        zeit = zeit_;
        voter = voter_;
    }

    // ------------------------------------------------------------------ views

    function lastApplicable(uint256 i) public view returns (uint256) {
        uint256 f = pools[i].periodFinish;
        return block.timestamp < f ? block.timestamp : f;
    }

    function rewardPerToken(uint256 i) public view returns (uint256) {
        Pool storage p = pools[i];
        if (p.totalStaked == 0) return p.rewardPerTokenStored;
        return p.rewardPerTokenStored + (lastApplicable(i) - p.lastUpdate) * p.rewardRate * 1e18 / p.totalStaked;
    }

    function earned(uint256 i, address u) public view returns (uint256) {
        return owed[i][u] + staked[i][u] * (rewardPerToken(i) - paidPerToken[i][u]) / 1e18;
    }

    function _update(uint256 i, address u) internal {
        Pool storage p = pools[i];
        p.rewardPerTokenStored = rewardPerToken(i);
        p.lastUpdate = lastApplicable(i);
        if (u != address(0)) {
            owed[i][u] = earned(i, u);
            paidPerToken[i][u] = p.rewardPerTokenStored;
        }
    }

    // ------------------------------------------------------------------ staking

    function stake(uint256 i, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(i, msg.sender);
        (address token,,) = market.entity(i);
        token.safeTransferFrom(msg.sender, address(this), amount);
        staked[i][msg.sender] += amount;
        pools[i].totalStaked += amount;
        emit Staked(i, msg.sender, amount);
    }

    function withdraw(uint256 i, uint256 amount) public nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _update(i, msg.sender);
        staked[i][msg.sender] -= amount;
        pools[i].totalStaked -= amount;
        (address token,,) = market.entity(i);
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(i, msg.sender, amount);
    }

    function getReward(uint256 i) public nonReentrant returns (uint256 r) {
        _update(i, msg.sender);
        r = owed[i][msg.sender];
        if (r != 0) {
            owed[i][msg.sender] = 0;
            zeit.safeTransfer(msg.sender, r);
            emit RewardPaid(i, msg.sender, r);
        }
    }

    // ------------------------------------------------------------------ emissions

    /// @notice Called by the CategoryVoter with this category's weekly ZEIT.
    function notifyRewardAmount(uint256 amount) external nonReentrant {
        if (msg.sender != voter) revert OnlyVoter();
        zeit.safeTransferFrom(msg.sender, address(this), amount);
        amount += pending;
        pending = 0;
        uint256 n = market.entityCount();
        uint256[] memory r = market.reserves();
        uint256 total;
        for (uint256 i; i < n; ++i) if (pools[i].totalStaked != 0) total += r[i];
        if (total == 0) {
            pending = amount; // nobody staked anywhere: carry to next week
            return;
        }
        uint256 used;
        for (uint256 i; i < n; ++i) {
            if (pools[i].totalStaked == 0) continue;
            uint256 amt = amount * r[i] / total;
            used += amt;
            _update(i, address(0));
            Pool storage p = pools[i];
            uint256 leftover = block.timestamp < p.periodFinish ? (p.periodFinish - block.timestamp) * p.rewardRate : 0;
            p.rewardRate = (amt + leftover) / DURATION;
            p.lastUpdate = block.timestamp;
            p.periodFinish = block.timestamp + DURATION;
        }
        pending = amount - used;
        emit Notified(amount);
    }
}
