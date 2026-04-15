import { MongoClient } from 'mongodb';

export const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'achmarket';
const MONGO_URI = process.env.MONGO_URI;

let cachedClient: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (cachedClient) {
    try {
      await cachedClient.db(MONGO_DB_NAME).command({ ping: 1 });
      return cachedClient;
    } catch {
      try {
        await cachedClient.close();
      } catch {
        // ignore close errors
      }
      cachedClient = null;
    }
  }

  cachedClient = new MongoClient(MONGO_URI, {
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  await cachedClient.connect();
  return cachedClient;
}
