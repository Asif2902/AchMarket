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

export async function fetchTradeEvents(marketAddress: string): Promise<TradeEvent[]> {
  const baseUrl = NETWORK.blockscoutApi;

  // Fetch buy and sell logs in parallel using topic0 filter
  const [buyRes, sellRes] = await Promise.all([
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=0&toBlock=latest&topic0=${SHARES_BOUGHT_TOPIC}`
    ),
    fetch(
      `${baseUrl}?module=logs&action=getLogs&address=${marketAddress}&fromBlock=0&toBlock=latest&topic0=${SHARES_SOLD_TOPIC}`
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
