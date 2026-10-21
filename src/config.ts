import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Loads `.env` files (never overriding variables already in the environment)
 * from: $IMAGEN_ENV_FILE, ./.env, ~/.imagen/.env.
 */
export function loadEnv(): void {
  const candidates = [
    process.env.IMAGEN_ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.imagen', '.env'),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      /* ignore unreadable env files */
    }
  }
}

export interface Config {
  outputDir: string;
  defaultModel: string | undefined;
  host: string;
  port: number;
  /** Public base URL used in A2A artifacts and resource links, e.g. http://127.0.0.1:4747 */
  publicUrl: string;
  gemini: { apiKey?: string; useGenerateContent: boolean };
  openai: { apiKey?: string; baseUrl?: string };
  azure: {
    endpoint?: string;
    apiKey?: string;
    apiVersion: string;
    /** Deployment names, optionally suffixed with ":openai" or ":bfl" to force a route. */
    deployments: string[];
  };
}

export function getConfig(): Config {
  loadEnv();
  const env = process.env;
  const host = env.IMAGEN_HOST ?? '127.0.0.1';
  const port = Number(env.IMAGEN_PORT ?? 4747);
  return {
    outputDir: expandHome(env.IMAGEN_OUTPUT_DIR ?? path.join(os.homedir(), '.imagen', 'images')),
    defaultModel: env.IMAGEN_DEFAULT_MODEL,
    host,
    port,
    publicUrl: env.IMAGEN_PUBLIC_URL ?? `http://${host}:${port}`,
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY,
      useGenerateContent: env.GEMINI_USE_GENERATE_CONTENT === '1' || env.GEMINI_USE_GENERATE_CONTENT === 'true',
    },
    openai: { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL },
    azure: {
      endpoint: env.AZURE_FOUNDRY_ENDPOINT ?? env.AZURE_OPENAI_ENDPOINT,
      apiKey: env.AZURE_FOUNDRY_API_KEY ?? env.AZURE_OPENAI_API_KEY,
      apiVersion: env.AZURE_FOUNDRY_API_VERSION ?? 'preview',
      deployments: (env.AZURE_FOUNDRY_DEPLOYMENTS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}
