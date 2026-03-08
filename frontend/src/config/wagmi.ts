import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
  coinbaseWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { NETWORK } from './network';

export const arcTestnet = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: NETWORK.nativeCurrency,
  rpcUrls: {
    default: { http: [NETWORK.rpcUrl] },
  },
});

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const getWallets = () => {
  const wallets = [
    injectedWallet,
    metaMaskWallet,
    coinbaseWallet,
  ];
  if (walletConnectProjectId) {
    wallets.push(walletConnectWallet);
  }
  return wallets;
};

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: getWallets(),
    },
  ],
  {
    appName: 'AchMarket',
    projectId: walletConnectProjectId || '',
  }
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(NETWORK.rpcUrl),
  },
});
