// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IResolvableMarket {
    function outcomeCount() external view returns (uint256);
    function stage() external view returns (uint8);
    function totalVolumeWei() external view returns (uint256);
    function resolutionTime() external view returns (uint256);
    function hasParticipated(address user) external view returns (bool);
    function resolveByManager(uint256 winningOutcome, string calldata proofUri) external;
    function cancelByManager(string calldata reason, string calldata proofUri) external;
}
