export interface PublicProfile {
  address: string;
  profileSlug: string;
  displayName: string;
  avatarUrl: string;
  twitterUrl: string;
  discordUrl: string;
  telegramUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioStats {
  totalPositions: number;
  totalMarkets: number;
  activePositions: number;
  resolvedPositions: number;
  totalDepositedWei: string;
  activeDepositsWei: string;
}

export interface PublicProfileResponse {
  profile: PublicProfile | null;
  stats: PortfolioStats;
}

export interface ProfileAvatarUploadResponse {
  url: string;
  key: string;
  byteLength: number;
  contentType: string;
}
