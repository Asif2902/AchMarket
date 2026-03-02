import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: 'ARC Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://arc-testnet.drpc.org/'] },
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
