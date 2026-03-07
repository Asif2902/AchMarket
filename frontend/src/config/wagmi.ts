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

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'placeholder_replace_with_real_id';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [
        injectedWallet,
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
  ],
  {
    appName: 'AchMarket',
    projectId: walletConnectProjectId,
  }
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(NETWORK.rpcUrl),
  },
});
