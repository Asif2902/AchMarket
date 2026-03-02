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

export const wagmiConfig = getDefaultConfig({
  appName: 'AchMarket',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [arcTestnet],
  ssr: false,
});
