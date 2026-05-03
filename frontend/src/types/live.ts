export type LiveFeedKind = 'crypto-price' | 'sports-score';
export type LiveCryptoMetric = 'price' | 'market-cap' | 'volume-24h';
export type EffectiveStatus = 'upcoming' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'unknown';

export interface LiveCryptoFeedConfig {
  coingeckoId: string;
  baseSymbol: string;
  quoteSymbol: string;
  vsCurrency: string;
  metric?: LiveCryptoMetric;
}

export interface LiveSportsFeedConfig {
  eventId: string;
  leagueName: string;
  homeTeam?: string;
  awayTeam?: string;
  forceUpcoming?: boolean;
}

export interface LiveFeedConfig {
  marketAddress: string;
  enabled: boolean;
  kind: LiveFeedKind;
  crypto: LiveCryptoFeedConfig | null;
  sports: (LiveSportsFeedConfig & { homeTeam?: string; awayTeam?: string; forceUpcoming?: boolean }) | null;
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
  metric: LiveCryptoMetric;
  price: number;
  change24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  sparkline: number[] | null;
  config?: LiveCryptoFeedConfig;
}

export interface LiveSportsMarketData {
  kind: 'sports-score';
  provider: string;
  providerRef: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  statusLabel: string;
  kickoffAt: string | null;
  config?: LiveSportsFeedConfig & { homeTeam?: string; awayTeam?: string; forceUpcoming?: boolean };
}

export type LiveMarketData = LiveCryptoMarketData | LiveSportsMarketData;

export type LiveCryptoDoc = LiveCryptoFeedConfig;
export type LiveSportsDoc = LiveSportsFeedConfig;

export interface LiveFeedDoc {
  marketAddress: string;
  enabled: boolean;
  kind: LiveFeedKind;
  crypto: LiveCryptoDoc | null;
  sports: LiveSportsDoc | null;
  createdAt?: Date;
  lastSnapshot?: CachedLiveSnapshot | null;
  lastSnapshotAt?: Date | null;
  updatedAt: Date;
  updatedBy: string;
}

export type LiveCryptoData = LiveCryptoMarketData;
export type LiveSportsData = LiveSportsMarketData;

export interface CachedLiveSnapshot {
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
  effectiveStatus?: EffectiveStatus;
}

export interface LiveMarketDataConfiguredResponse {
  configured: true;
  stale: boolean;
  finalSnapshot?: boolean;
  asOf: string;
  fetchedAt: string;
  nextSuggestedPollSeconds: number;
  data: LiveMarketData;
  effectiveStatus?: EffectiveStatus;
  refreshFailed?: boolean;
}

export interface LiveMarketDataUnconfiguredResponse {
  configured: false;
  reason?: string;
}

export type LiveConfiguredResponse = LiveMarketDataConfiguredResponse;
export type LiveUnconfiguredResponse = LiveMarketDataUnconfiguredResponse;

export type LiveMarketDataResponse =
  | LiveMarketDataConfiguredResponse
  | LiveMarketDataUnconfiguredResponse;

export interface LiveFeedSuggestionInput {
  title: string;
  category?: string;
  description?: string;
  outcomeLabels?: string[];
}

export interface LiveCryptoSuggestion {
  detected: boolean;
  confidence: number;
  reason: string;
  coingeckoId: string | null;
  baseSymbol: string | null;
  quoteSymbol: string;
  vsCurrency: string;
  metric: LiveCryptoMetric;
}

export interface LiveCryptoSearchCandidate {
  id: string;
  symbol: string;
  name: string;
  thumb: string | null;
  large?: string | null;
  marketCapRank: number | null;
}

export interface LiveCryptoSearchResponse {
  query: string;
  candidates: LiveCryptoSearchCandidate[];
}

export interface LiveSportsSuggestionCandidate {
  eventId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  status: string;
  statusLabel: string;
  matchScore?: number;
}

export interface LiveSportsSuggestion {
  detected: boolean;
  confidence: number;
  reason: string;
  homeTeam: string | null;
  awayTeam: string | null;
  selectedEventId: string | null;
  selectedLeagueName: string | null;
  candidates: LiveSportsSuggestionCandidate[];
}

export interface LiveFeedSuggestionsResponse {
  crypto: LiveCryptoSuggestion;
  sports: LiveSportsSuggestion;
}

export interface LiveSportsSearchResponse {
  query: string;
  candidates: LiveSportsSuggestionCandidate[];
}
