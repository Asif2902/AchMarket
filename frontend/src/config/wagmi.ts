import { getDefaultConfig } from '@rainbow-me/rainbowkit';
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
if (!walletConnectProjectId) {
  throw new Error('Missing WalletConnect project ID: VITE_WALLETCONNECT_PROJECT_ID');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'AchMarket',
  projectId: walletConnectProjectId,
  chains: [arcTestnet],
  ssr: false,
});
