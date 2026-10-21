import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageInput, OutputFormat } from './types.js';

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

export function formatToMime(format: OutputFormat | undefined): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

/** Reads a local file path, data: URL, or http(s) URL into an ImageInput. */
export async function loadImageInput(ref: string): Promise<ImageInput> {
  if (ref.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref);
    if (!match) throw new Error('Malformed data URL');
    const mimeType = match[1] || 'application/octet-stream';
    const data = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
    return { data, mimeType };
  }
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`Failed to fetch ${ref}: ${res.status}`);
    const mimeType = res.headers.get('content-type')?.split(';')[0] || sniffMime(ref);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType, name: path.basename(new URL(ref).pathname) };
  }
  const file = ref.startsWith('file://') ? new URL(ref).pathname : ref;
  const data = await fs.readFile(file);
  return { data, mimeType: sniffMime(file, data), name: path.basename(file) };
}

export function sniffMime(name: string, data?: Buffer): string {
  if (data && data.length > 12) {
    if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
    if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
    if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (data.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  }
  const ext = path.extname(name).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'image';
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Maps an aspect ratio to the closest OpenAI-style WxH size. */
export function aspectToSize(aspect: string | undefined, base = 1024): string | undefined {
  if (!aspect) return undefined;
  const [w, h] = aspect.split(':').map(Number);
  if (!w || !h) return undefined;
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return `${base}x${base}`;
  if (r > 1) return `${Math.round(base * 1.5)}x${base}`;
  return `${base}x${Math.round(base * 1.5)}`;
}

/** Maps an aspect ratio to width/height at roughly 1MP, rounded to multiples of 16. */
export function aspectToDims(aspect: string | undefined, size?: string): { width: number; height: number } {
  if (size) {
    const m = /^(\d+)x(\d+)$/i.exec(size);
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  }
  const [w, h] = (aspect ?? '1:1').split(':').map(Number);
  const ratio = w && h ? w / h : 1;
  const area = 1024 * 1024;
  const width = Math.round(Math.sqrt(area * ratio) / 16) * 16;
  const height = Math.round(Math.sqrt(area / ratio) / 16) * 16;
  return { width, height };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: number; error?: { message?: string } };
    const detail = anyErr.error?.message;
    return detail ? `${err.message} (${detail})` : err.message;
  }
  return String(err);
}
