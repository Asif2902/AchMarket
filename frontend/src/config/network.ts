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

export const HYBRID_FACTORY_ADDRESS = '0x2e7De7485438F18a8eCc337eA451e1e7Dc75AeBb';
export const MARKET_V2_IMPLEMENTATION_ADDRESS = '0x3611D364883aD654909A5202111240697bA2b647';
export const MARKET_ROUTER_ADDRESS = '0x608c4BD80bC1732d95E752c69ce2F6C53A1ad02C';
export const ORDER_BOOK_ADDRESS = '0x0F96892dDE826e366f89AE8eDf0A4114aDa09cF2';
export const RESOLUTION_MANAGER_ADDRESS = '0x6FD9e1b14c1c3cA3f60C922040b28DF637B17b2f';
export const HYBRID_LENS_ADDRESS = '0x87D9Df71ADCD7C21143B072AaBCFbf24D256d557';
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
