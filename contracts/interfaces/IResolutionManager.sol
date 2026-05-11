// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IResolutionManager {
    function setMarketAllowed(address market, bool allowed) external;
}
