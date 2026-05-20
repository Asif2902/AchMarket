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
  blockTime: 0.5,
} as const;

export const LEGACY_FACTORY_ADDRESS = '0xd7b122B12caCB299249f89be7F241a47f762f283';
export const LEGACY_LENS_ADDRESS = '0x8241ACa87D4Dee4CA167b1e172Ed955522599e70';

export const HYBRID_FACTORY_ADDRESS = '0x5D27ae51B72f771E2AE40C82eD178aC917e8476C';
export const MARKET_V2_IMPLEMENTATION_ADDRESS = '0xdb7c8323E6826781ADf57D656D9fB6AcFFcCc055';
export const MARKET_ROUTER_ADDRESS = '0xc86a8BC775aFe76Dac3e95eF1a3e8A404aD0c09a';
export const ORDER_BOOK_ADDRESS = '0x2a615EB438c0D4eC6ACbbDa96b8Ea5Ede245Aa1e';
export const RESOLUTION_MANAGER_ADDRESS = '0x9a977E6C21f851970edb7fa6B42aD994C9C39A5a';
export const HYBRID_LENS_ADDRESS = '0xD10c8808BB9c96D5a5f9c9372f3D9ed11E332E89';
export const PROTOCOL_OWNER_ADDRESS = '0x6e0df2d65d309b55B217B5237657302386E75584';

export const FACTORY_ADDRESS = HYBRID_FACTORY_ADDRESS;
export const LENS_ADDRESS = HYBRID_LENS_ADDRESS;

export const STAGE = {
  Active: 0,
  Suspended: 1,
  Resolved: 2,
  Cancelled: 3,
  Expired: 4,
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

export const STAGE_LABELS: Record<number, string> = {
  0: 'Active',
  1: 'Suspended',
  2: 'Resolved',
  3: 'Cancelled',
  4: 'Expired',
};

export const STAGE_COLORS: Record<number, string> = {
  0: 'bg-green-500/20 text-green-400 border-green-500/30',
  1: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  2: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  3: 'bg-red-500/20 text-red-400 border-red-500/30',
  4: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};
