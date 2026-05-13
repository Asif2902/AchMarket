// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IHybridMarket {
    function outcomeCount() external view returns (uint256);
    function marketDeadline() external view returns (uint256);
    function marketMode() external view returns (uint8);
    function isTradingOpen() external view returns (bool);
    function getImpliedProbability(uint256 outcomeIdx) external view returns (uint256);
    function previewBuy(uint256 outcomeIdx, uint256 sharesWad) external view returns (uint256);
    function previewSell(uint256 outcomeIdx, uint256 sharesWad) external view returns (uint256);

    function buyFor(address trader, uint256 outcomeIdx, uint256 sharesWad, uint256 maxCostWei)
        external
        payable
        returns (uint256 costWei);

    function sellFrom(
        address trader,
        uint256 outcomeIdx,
        uint256 sharesWad,
        uint256 minReceiveWei,
        address payable recipient
    ) external returns (uint256 proceedsWei);

    function moveShares(address from, address to, uint256 outcomeIdx, uint256 sharesWad)
        external
        returns (bool);

    function mintCompleteSet(
        address outcomeARecipient,
        uint256 outcomeA,
        address outcomeBRecipient,
        uint256 outcomeB,
        uint256 sharesWad
    ) external payable returns (bool);
}
