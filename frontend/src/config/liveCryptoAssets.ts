export interface LiveCryptoAsset {
  id: string;
  symbol: string;
  aliases: string[];
}

export const LIVE_CRYPTO_ASSETS: LiveCryptoAsset[] = [
  { id: 'bitcoin', symbol: 'BTC', aliases: ['btc', 'bitcoin', 'xbt'] },
  { id: 'ethereum', symbol: 'ETH', aliases: ['eth', 'ethereum'] },
  { id: 'solana', symbol: 'SOL', aliases: ['sol', 'solana'] },
  { id: 'binancecoin', symbol: 'BNB', aliases: ['bnb', 'binance', 'binance coin'] },
  { id: 'ripple', symbol: 'XRP', aliases: ['xrp', 'ripple'] },
  { id: 'dogecoin', symbol: 'DOGE', aliases: ['doge', 'dogecoin'] },
  { id: 'cardano', symbol: 'ADA', aliases: ['ada', 'cardano'] },
  { id: 'avalanche-2', symbol: 'AVAX', aliases: ['avax', 'avalanche'] },
  { id: 'toncoin', symbol: 'TON', aliases: ['ton', 'toncoin'] },
  { id: 'chainlink', symbol: 'LINK', aliases: ['link', 'chainlink'] },
  { id: 'sui', symbol: 'SUI', aliases: ['sui'] },
  { id: 'polkadot', symbol: 'DOT', aliases: ['dot', 'polkadot'] },
  { id: 'tron', symbol: 'TRX', aliases: ['trx', 'tron'] },
  { id: 'arbitrum', symbol: 'ARB', aliases: ['arb', 'arbitrum'] },
  { id: 'optimism', symbol: 'OP', aliases: ['op', 'optimism'] },
];
