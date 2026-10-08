// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @notice A position in one entity of a category. Minted and burned only by its CategoryMarket.
contract EntityToken is ERC20 {
    error OnlyMarket();

    address public immutable market;
    string private _name;
    string private _symbol;

    constructor(string memory name_, string memory symbol_) {
        market = msg.sender;
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _burn(from, amount);
    }
}
