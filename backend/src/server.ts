import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';

import chatHandler from './api/chat.js';
import liveFeedConfigHandler from './api/live-feed-config.js';
import liveFeedSearchHandler from './api/live-feed-search.js';
import liveFeedSuggestHandler from './api/live-feed-suggest.js';
import liveMarketHandler from './api/live-market.js';
import liveTokenSearchHandler from './api/live-token-search.js';
import linkPreviewHandler from './api/link-preview.js';
import marketMediaHandler from './api/market-media.js';
import profileHandler from './api/profile.js';
import profileAvatarHandler from './api/profile-avatar.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);
const bodyLimit = process.env.BODY_LIMIT ?? '15mb';

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (!origin) return callback(null, false);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
};

type ApiHandler = (req: Request, res: Response) => Promise<unknown>;

function asyncHandler(handler: ApiHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'achmarket-backend' });
});

app.all('/api/chat', asyncHandler(chatHandler));
app.all('/api/live-feed-config', asyncHandler(liveFeedConfigHandler));
app.all('/api/live-feed-search', asyncHandler(liveFeedSearchHandler));
app.all('/api/live-feed-suggest', asyncHandler(liveFeedSuggestHandler));
app.all('/api/live-market', asyncHandler(liveMarketHandler));
app.all('/api/live-token-search', asyncHandler(liveTokenSearchHandler));
app.all('/api/link-preview', asyncHandler(linkPreviewHandler));
app.all('/api/market-media', asyncHandler(marketMediaHandler));
app.all('/api/profile', asyncHandler(profileHandler));
app.all('/api/profile-avatar', asyncHandler(profileAvatarHandler));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled backend error', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`AchMarket backend listening on port ${port}`);
});
