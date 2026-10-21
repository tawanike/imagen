import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GenerateResult, ManifestEntry, SavedImage } from './types.js';
import { mimeToExt, slugify, timestamp } from './util.js';

export interface SaveOptions {
  dir: string;
  /** Base filename (without extension). Defaults to a slug of the prompt + timestamp. */
  baseName?: string;
  prompt: string;
  params?: Record<string, unknown>;
  /** When set, a URL is computed for each file as `${publicUrl}/images/<relative path>`. */
  publicUrl?: string;
  /** Root directory the public URL maps to (defaults to dir). */
  publicRoot?: string;
}

export async function saveImages(result: GenerateResult, opts: SaveOptions): Promise<{ saved: SavedImage[]; entry: ManifestEntry }> {
  await fs.mkdir(opts.dir, { recursive: true });
  const base = opts.baseName ?? `${slugify(opts.prompt)}_${timestamp()}`;
  const saved: SavedImage[] = [];
  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];
    const ext = mimeToExt(img.mimeType);
    const name = result.images.length === 1 ? `${base}.${ext}` : `${base}_${i + 1}.${ext}`;
    const file = path.join(opts.dir, name);
    await fs.writeFile(file, img.data);
    let url: string | undefined;
    if (opts.publicUrl) {
      const root = opts.publicRoot ?? opts.dir;
      const rel = path.relative(root, file);
      if (!rel.startsWith('..')) url = `${opts.publicUrl.replace(/\/$/, '')}/images/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
    }
    saved.push({ path: file, url, mimeType: img.mimeType, bytes: img.data.length });
  }
  const entry: ManifestEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    prompt: opts.prompt,
    provider: result.provider,
    model: result.model,
    files: saved.map((s) => s.path),
    params: opts.params ?? {},
    durationMs: result.durationMs,
  };
  await appendManifest(opts.dir, entry);
  return { saved, entry };
}

export function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.jsonl');
}

async function appendManifest(dir: string, entry: ManifestEntry): Promise<void> {
  await fs.appendFile(manifestPath(dir), JSON.stringify(entry) + '\n');
}

export async function readManifest(dir: string, limit = 20): Promise<ManifestEntry[]> {
  try {
    const text = await fs.readFile(manifestPath(dir), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as ManifestEntry);
  } catch {
    return [];
  }
}
