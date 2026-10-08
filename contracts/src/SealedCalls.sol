// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Sealed attention calls: a prediction is published encrypted, timestamped by the chain, and
///         opened later by publishing that one call's key.
/// @dev The key is derived client-side from the caller's passkey (Mera PRF, namespace
///      "zeitgeist.calls.v1", then HKDF per call id), so revealing one call exposes no other call and
///      nothing secret is stored anywhere. The contract cannot check decryption; AES-GCM's tag does
///      that off-chain: a wrong key fails to open the ciphertext, so a reveal is self-verifying.
contract SealedCalls {
    error Exists();
    error NotCaller();
    error AlreadyRevealed();
    error BadHorizon();
    error TooLarge();

    struct Call {
        address caller;
        uint64 sealedAt;
        uint64 horizonEnd;   // the call is scored at this time
        bool revealed;
    }

    uint256 public constant MAX_CIPHERTEXT = 1024;
    uint64 public constant MIN_HORIZON = 1 hours;
    uint64 public constant MAX_HORIZON = 30 days;

    mapping(bytes16 => Call) public calls;

    event Sealed(address indexed caller, bytes16 indexed callId, uint64 horizonEnd, bytes ciphertext);
    event Revealed(address indexed caller, bytes16 indexed callId, bytes32 key);

    function seal(bytes16 callId, uint64 horizon, bytes calldata ciphertext) external {
        if (calls[callId].caller != address(0)) revert Exists();
        if (horizon < MIN_HORIZON || horizon > MAX_HORIZON) revert BadHorizon();
        if (ciphertext.length > MAX_CIPHERTEXT) revert TooLarge();
        uint64 end = uint64(block.timestamp) + horizon;
        calls[callId] = Call(msg.sender, uint64(block.timestamp), end, false);
        emit Sealed(msg.sender, callId, end, ciphertext);
    }

    function reveal(bytes16 callId, bytes32 key) external {
        Call storage c = calls[callId];
        if (c.caller != msg.sender) revert NotCaller();
        if (c.revealed) revert AlreadyRevealed();
        c.revealed = true;
        emit Revealed(msg.sender, callId, key);
    }
}
