export const NETWORK = {
  chainId: 5042002,
  chainIdHex: '0x4CEC52',
  name: 'ARC Testnet',
  rpcUrl: 'https://arc-testnet.drpc.org/',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  blockExplorer: '',
} as const;

export const FACTORY_ADDRESS = '0x7B7D71141B5b9b2F42E6D7Bf1657ad9c2B140272';

export const STAGE = {
  Active: 0,
  Resolved: 1,
  Cancelled: 2,
  Expired: 3,
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

export const STAGE_LABELS: Record<number, string> = {
  0: 'Active',
  1: 'Resolved',
  2: 'Cancelled',
  3: 'Expired',
};

export const STAGE_COLORS: Record<number, string> = {
  0: 'bg-green-500/20 text-green-400 border-green-500/30',
  1: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  2: 'bg-red-500/20 text-red-400 border-red-500/30',
  3: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};
