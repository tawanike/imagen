import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { hostnameFromHostHeader, isLoopbackBind, localOnlyGuard } from '../src/guard.js';

function run(headers: Record<string, string>, extra: string[] = []) {
  let status = 200;
  let nextCalled = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    type() {
      return this;
    },
    send() {
      return this;
    },
  } as unknown as Response;
  localOnlyGuard(extra)({ headers } as Request, res, () => {
    nextCalled = true;
  });
  return { status, nextCalled };
}

describe('localOnlyGuard', () => {
  it('allows loopback hosts without an Origin', () => {
    expect(run({ host: '127.0.0.1:4747' }).nextCalled).toBe(true);
    expect(run({ host: 'localhost:4747' }).nextCalled).toBe(true);
    expect(run({ host: '[::1]:4747' }).nextCalled).toBe(true);
  });
  it('blocks DNS-rebinding style Host headers', () => {
    const r = run({ host: 'evil.example.com:4747' });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });
  it('blocks cross-site Origins even with a local Host', () => {
    const r = run({ host: 'localhost:4747', origin: 'https://evil.example.com' });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
  });
  it('allows a local Origin and configured extra hostnames', () => {
    expect(run({ host: 'localhost:4747', origin: 'http://localhost:3000' }).nextCalled).toBe(true);
    expect(run({ host: 'imagen.local:4747' }, ['imagen.local']).nextCalled).toBe(true);
  });
  it('parses host headers and loopback binds', () => {
    expect(hostnameFromHostHeader('[::1]:80')).toBe('::1');
    expect(hostnameFromHostHeader('LocalHost:1')).toBe('localhost');
    expect(isLoopbackBind('0.0.0.0')).toBe(false);
    expect(isLoopbackBind('127.0.0.1')).toBe(true);
  });
});
