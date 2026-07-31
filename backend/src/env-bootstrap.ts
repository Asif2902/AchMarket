/**
 * Must be imported first from server.ts so .env is loaded before other modules
 * read process.env (ESM evaluates imports before module body).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
// repo root .env (PM2 cwd / VPS layout)
dotenv.config({ path: path.resolve(here, "../../.env") });
// backend/.env optional override
dotenv.config({ path: path.resolve(here, "../.env") });
