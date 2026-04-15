export type LiveFeedKind = 'crypto-price' | 'sports-score';

export interface LiveCryptoFeedConfig {
  coingeckoId: string;
  baseSymbol: string;
  quoteSymbol: string;
  vsCurrency: string;
}

export interface LiveSportsFeedConfig {
  eventId: string;
  leagueName: string;
}

export interface LiveFeedConfig {
  marketAddress: string;
  enabled: boolean;
  kind: LiveFeedKind;
  crypto: LiveCryptoFeedConfig | null;
  sports: LiveSportsFeedConfig | null;
  updatedAt: string;
  updatedBy: string;
}

export type LiveFeedConfigInput =
  | {
      marketAddress: string;
      enabled: boolean;
      kind: 'crypto-price';
      crypto: LiveCryptoFeedConfig;
      sports?: null;
    }
  | {
      marketAddress: string;
      enabled: boolean;
      kind: 'sports-score';
      sports: LiveSportsFeedConfig;
      crypto?: null;
    };

export interface LiveCryptoMarketData {
  kind: 'crypto-price';
  provider: string;
  providerRef: string;
  baseSymbol: string;
  quoteSymbol: string;
  price: number;
  change24h: number | null;
}

export interface LiveSportsMarketData {
  kind: 'sports-score';
  provider: string;
  providerRef: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  statusLabel: string;
  kickoffAt: string | null;
}

export type LiveMarketData = LiveCryptoMarketData | LiveSportsMarketData;

export interface LiveMarketDataConfiguredResponse {
  configured: true;
  stale: boolean;
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
}

export interface LiveMarketDataUnconfiguredResponse {
  configured: false;
  reason?: string;
}

export type LiveMarketDataResponse =
  | LiveMarketDataConfiguredResponse
  | LiveMarketDataUnconfiguredResponse;
