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
  blockExplorer: 'https://testnet.arcscan.app',
  blockscoutApi: 'https://testnet.arcscan.app/api',
} as const;

export const FACTORY_ADDRESS = '0x249A649e138f46318AfC0aD128fe0fd432902e48';
export const LENS_ADDRESS = '0xF9e1DFa4d020fbd70924200d27E82B520D178354';

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
