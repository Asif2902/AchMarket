import { ethers } from 'ethers';
import { NETWORK } from '../config/network';

/* ─── Types ─── */

export interface TradeEvent {
  type: 'buy' | 'sell';
  trader: string;
  outcomeIndex: number;
  sharesWad: bigint;
  costOrProceedsWei: bigint;
  timestamp: number;
  blockNumber: number;
  txHash: string;
}

interface BlockscoutLogEntry {
  address: string;
  blockNumber: string;
  data: string;
  gasPrice: string;
  gasUsed: string;
  logIndex: string;
  timeStamp: string;
  topics: (string | null)[];
  transactionHash: string;
  transactionIndex: string;
}

/* ─── Event Signature Hashes ─── */

const SHARES_BOUGHT_TOPIC = ethers.id('SharesBought(address,uint256,uint256,uint256)');
const SHARES_SOLD_TOPIC = ethers.id('SharesSold(address,uint256,uint256,uint256)');

/* ─── Fetch trade events from BlockScout ─── */

export async function fetchTradeEvents(
  marketAddress: string,
  options?: { startBlock?: number }
): Promise<TradeEvent[]> {
  const baseUrl = NETWORK.blockscoutApi;
  const fromBlock = options?.startBlock ?? 0;

  // Fetch buy and sell logs in parallel using topic0 filter
  const [buyRes, sellRes] = await Promise.all([
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=${fromBlock}&toBlock=latest&topic0=${SHARES_BOUGHT_TOPIC}`
    ),
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=${fromBlock}&toBlock=latest&topic0=${SHARES_SOLD_TOPIC}`
    ),
  ]);

  const [buyData, sellData] = await Promise.all([buyRes.json(), sellRes.json()]);

  const events: TradeEvent[] = [];

  // Parse buy events
  if (buyData.status === '1' && Array.isArray(buyData.result)) {
    for (const log of buyData.result as BlockscoutLogEntry[]) {
      const parsed = parseTradeLog(log, 'buy');
      if (parsed) events.push(parsed);
    }
  }

  // Parse sell events
  if (sellData.status === '1' && Array.isArray(sellData.result)) {
    for (const log of sellData.result as BlockscoutLogEntry[]) {
      const parsed = parseTradeLog(log, 'sell');
      if (parsed) events.push(parsed);
    }
  }

  // Sort by block number, then log index for deterministic ordering
  events.sort((a, b) => a.blockNumber - b.blockNumber);

  return events;
}

/* ─── Compute volume from trade events ─── */

/**
 * Compute total trading volume (buys + sells) from trade events.
 * This is more accurate than the on-chain totalVolumeWei which only tracks buy-side LMSR cost.
 */
export function computeVolumeFromEvents(events: TradeEvent[]): bigint {
  let total = 0n;
  for (const e of events) {
    total += e.costOrProceedsWei;
  }
  return total;
}

/**
 * Fetch accurate total volume for a single market from BlockScout events.
 * Returns the sum of all buy costs + sell proceeds.
 */
export async function fetchMarketVolume(marketAddress: string): Promise<bigint> {
  const events = await fetchTradeEvents(marketAddress);
  return computeVolumeFromEvents(events);
}

/**
 * Fetch accurate volumes for multiple markets in parallel.
 * Returns a Map of marketAddress → totalVolume.
 * Falls back to 0n for any market whose events fail to fetch.
 */
export async function fetchAllMarketVolumes(
  marketAddresses: string[]
): Promise<Map<string, bigint>> {
  const results = await Promise.allSettled(
    marketAddresses.map(async (addr) => ({
      addr: addr.toLowerCase(),
      volume: await fetchMarketVolume(addr),
    }))
  );

  const volumes = new Map<string, bigint>();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      volumes.set(r.value.addr, r.value.volume);
    }
  }
  return volumes;
}

/* ─── Parse a single log entry into a TradeEvent ─── */

function parseTradeLog(log: BlockscoutLogEntry, type: 'buy' | 'sell'): TradeEvent | null {
  try {
    // topics[1] = indexed trader address (padded to 32 bytes)
    // topics[2] = indexed outcomeIndex (padded to 32 bytes)
    const traderTopic = log.topics[1];
    const outcomeTopic = log.topics[2];
    if (!traderTopic || !outcomeTopic) return null;

    const trader = '0x' + traderTopic.slice(26); // extract last 20 bytes
    const outcomeIndex = parseInt(outcomeTopic, 16);

    // data contains: sharesWad (uint256) + costWei/proceedsWei (uint256)
    const data = log.data;
    if (data.length < 130) return null; // 0x + 64 + 64 = 130

    const sharesWad = BigInt('0x' + data.slice(2, 66));
    const costOrProceedsWei = BigInt('0x' + data.slice(66, 130));

    const timestamp = parseInt(log.timeStamp, 16);
    const blockNumber = parseInt(log.blockNumber, 16);

    return {
      type,
      trader,
      outcomeIndex,
      sharesWad,
      costOrProceedsWei,
      timestamp,
      blockNumber,
      txHash: log.transactionHash,
    };
  } catch {
    return null;
  }
}
