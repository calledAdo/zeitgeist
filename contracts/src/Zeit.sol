// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "solady/tokens/ERC20.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @notice ZEIT: the emission token. Only the Minter mints after the initial supply.
contract Zeit is ERC20, Ownable {
    error OnlyMinter();

    address public minter;

    constructor(address owner_, address initialHolder, uint256 initialSupply) {
        _initializeOwner(owner_);
        _mint(initialHolder, initialSupply);
    }

    function name() public pure override returns (string memory) { return "Zeitgeist"; }
    function symbol() public pure override returns (string memory) { return "ZEIT"; }

    /// @notice One-time handoff of mint rights to the Minter.
    function setMinter(address m) external onlyOwner {
        minter = m;
        renounceOwnership();
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        _mint(to, amount);
    }
}
