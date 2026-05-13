import { ethers } from 'ethers';
import { MARKET_ROUTER_ADDRESS, NETWORK, ORDER_BOOK_ADDRESS } from '../config/network';

/* ─── Types ─── */

export interface TradeEvent {
  type: 'buy' | 'sell';
  source: 'CLOB' | 'MM' | 'SPLIT';
  trader: string;
  outcomeIndex: number;
  sharesWad: bigint;
  costOrProceedsWei: bigint;
  feeWei: bigint;
  priceWad: bigint;
  timestamp: number;
  blockNumber: number;
  logIndex: number;
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
const EXECUTED_TRADE_TOPIC = ethers.id('TradeExecuted(address,address,uint256,uint256,uint256,uint256,uint8,uint8,uint256,uint256)');

/* ─── Fetch trade events from BlockScout ─── */

export async function fetchTradeEvents(
  marketAddress: string,
  options?: { startBlock?: number }
): Promise<TradeEvent[]> {
  const baseUrl = NETWORK.blockscoutApi;
  const fromBlock = options?.startBlock ?? 0;

  // Fetch buy and sell logs in parallel using topic0 filter
  const marketTopic = `0x${marketAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  const [buyRes, sellRes, routerTradeRes, orderBookTradeRes] = await Promise.all([
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=${fromBlock}&toBlock=latest&topic0=${SHARES_BOUGHT_TOPIC}`
    ),
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=${fromBlock}&toBlock=latest&topic0=${SHARES_SOLD_TOPIC}`
    ),
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${MARKET_ROUTER_ADDRESS}&fromBlock=${fromBlock}&toBlock=latest&topic0=${EXECUTED_TRADE_TOPIC}&topic2=${marketTopic}`
    ),
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${ORDER_BOOK_ADDRESS}&fromBlock=${fromBlock}&toBlock=latest&topic0=${EXECUTED_TRADE_TOPIC}&topic2=${marketTopic}`
    ),
  ]);

  const [buyData, sellData, routerTradeData, orderBookTradeData] = await Promise.all([
    buyRes.json(),
    sellRes.json(),
    routerTradeRes.json(),
    orderBookTradeRes.json(),
  ]);

  const events: TradeEvent[] = [];
  const executedTxs = new Set<string>();

  for (const data of [routerTradeData, orderBookTradeData]) {
    if (data.status === '1' && Array.isArray(data.result)) {
      for (const log of data.result as BlockscoutLogEntry[]) {
        const parsed = parseExecutedTradeLog(log);
        if (parsed) {
          events.push(parsed);
          executedTxs.add(parsed.txHash.toLowerCase());
        }
      }
    }
  }

  // Legacy MM events are kept as a fallback for older deployments. New router
  // TradeExecuted logs are authoritative, so skip duplicated transaction hashes.
  if (buyData.status === '1' && Array.isArray(buyData.result)) {
    for (const log of buyData.result as BlockscoutLogEntry[]) {
      if (executedTxs.has(log.transactionHash.toLowerCase())) continue;
      const parsed = parseTradeLog(log, 'buy');
      if (parsed) events.push(parsed);
    }
  }

  if (sellData.status === '1' && Array.isArray(sellData.result)) {
    for (const log of sellData.result as BlockscoutLogEntry[]) {
      if (executedTxs.has(log.transactionHash.toLowerCase())) continue;
      const parsed = parseTradeLog(log, 'sell');
      if (parsed) events.push(parsed);
    }
  }

  // Sort by block number, then log index for deterministic ordering
  events.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber);

  return events;
}

/* ─── Compute volume from trade events ─── */

/**
 * Compute total trading volume (buys + sells) from trade events.
 * This is more accurate than the on-chain totalVolumeWei because it includes CLOB and MM fills.
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
      source: 'MM',
      trader,
      outcomeIndex,
      sharesWad,
      costOrProceedsWei,
      feeWei: 0n,
      priceWad: sharesWad > 0n ? (costOrProceedsWei * 1_000_000_000_000_000_000n) / sharesWad : 0n,
      timestamp,
      blockNumber,
      logIndex: parseInt(log.logIndex, 16),
      txHash: log.transactionHash,
    };
  } catch {
    return null;
  }
}

function parseExecutedTradeLog(log: BlockscoutLogEntry): TradeEvent | null {
  try {
    const traderTopic = log.topics[1];
    const outcomeTopic = log.topics[3];
    if (!traderTopic || !outcomeTopic) return null;

    const trader = '0x' + traderTopic.slice(26);
    const outcomeIndex = parseInt(outcomeTopic, 16);
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256', 'uint8', 'uint8', 'uint256', 'uint256'],
      log.data
    );
    const priceWad = decoded[0] as bigint;
    const sharesWad = decoded[1] as bigint;
    const timestamp = Number(decoded[2]);
    const sourceRaw = Number(decoded[3]);
    const side = Number(decoded[4]);
    const notionalWei = decoded[5] as bigint;
    const feeWei = decoded[6] as bigint;
    const blockNumber = parseInt(log.blockNumber, 16);
    const source = sourceRaw === 2 ? 'SPLIT' : sourceRaw === 1 ? 'MM' : 'CLOB';

    return {
      type: side === 0 ? 'buy' : 'sell',
      source,
      trader,
      outcomeIndex,
      sharesWad,
      costOrProceedsWei: notionalWei,
      feeWei,
      priceWad,
      timestamp,
      blockNumber,
      logIndex: parseInt(log.logIndex, 16),
      txHash: log.transactionHash,
    };
  } catch {
    return null;
  }
}
