// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

/// @notice veZEIT: lock ZEIT for up to 52 weeks for non-transferable voting power that decays linearly
///         to zero at unlock. One lock per address. Unlock times round down to a week boundary.
contract VotingEscrow {
    using SafeTransferLib for address;

    error BadDuration();
    error NoLock();
    error LockExists();
    error StillLocked();
    error ZeroAmount();

    uint256 public constant WEEK = 1 weeks;
    uint256 public constant MAXTIME = 52 weeks;

    address public immutable zeit;

    struct Lock {
        uint128 amount;
        uint64 end;
    }

    mapping(address => Lock) public locks;
    uint256 public totalLocked;

    event Locked(address indexed user, uint256 amount, uint256 end);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address zeit_) {
        zeit = zeit_;
    }

    function createLock(uint256 amount, uint256 duration) external {
        if (amount == 0) revert ZeroAmount();
        if (locks[msg.sender].amount != 0) revert LockExists();
        uint256 end = (block.timestamp + duration) / WEEK * WEEK;
        if (end <= block.timestamp || end > block.timestamp + MAXTIME) revert BadDuration();
        zeit.safeTransferFrom(msg.sender, address(this), amount);
        locks[msg.sender] = Lock(uint128(amount), uint64(end));
        totalLocked += amount;
        emit Locked(msg.sender, amount, end);
    }

    function increaseAmount(uint256 amount) external {
        Lock storage l = locks[msg.sender];
        if (l.amount == 0 || l.end <= block.timestamp) revert NoLock();
        if (amount == 0) revert ZeroAmount();
        zeit.safeTransferFrom(msg.sender, address(this), amount);
        l.amount += uint128(amount);
        totalLocked += amount;
        emit Locked(msg.sender, l.amount, l.end);
    }

    function extend(uint256 duration) external {
        Lock storage l = locks[msg.sender];
        if (l.amount == 0 || l.end <= block.timestamp) revert NoLock();
        uint256 end = (block.timestamp + duration) / WEEK * WEEK;
        if (end <= l.end || end > block.timestamp + MAXTIME) revert BadDuration();
        l.end = uint64(end);
        emit Locked(msg.sender, l.amount, end);
    }

    function withdraw() external {
        Lock memory l = locks[msg.sender];
        if (l.amount == 0) revert NoLock();
        if (block.timestamp < l.end) revert StillLocked();
        delete locks[msg.sender];
        totalLocked -= l.amount;
        zeit.safeTransfer(msg.sender, l.amount);
        emit Withdrawn(msg.sender, l.amount);
    }

    /// @notice Current voting power: amount × time remaining / 52 weeks.
    function votingPower(address user) public view returns (uint256) {
        Lock memory l = locks[user];
        if (l.end <= block.timestamp) return 0;
        return uint256(l.amount) * (l.end - block.timestamp) / MAXTIME;
    }
}
