import express from 'express';
import type { Server } from 'node:http';
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildAgentCard, ImagenAgentExecutor } from './a2a/agent.js';
import { createMcpServer } from './mcp/server.js';
import type { ImagenService } from './service.js';

export interface HttpOptions {
  host: string;
  port: number;
  publicUrl: string;
}

export function createApp(service: ImagenService, opts: HttpOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // --- MCP (Streamable HTTP) at /mcp -------------------------------------
  const mcpHandler = createMcpHandler(() => createMcpServer(service), {
    onerror: (err) => console.error('[mcp]', err.message),
  });
  app.all('/mcp', toNodeHandler(mcpHandler));

  // --- A2A at /a2a with the card at /.well-known/agent-card.json ----------
  const card = buildAgentCard(service, opts.publicUrl);
  const requestHandler = new DefaultRequestHandler(card, new InMemoryTaskStore(), new ImagenAgentExecutor(service));
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler, legacyCompat: { enabled: true } }));
  app.use('/a2a', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication, legacyCompat: { enabled: true } }));

  // --- Generated files + diagnostics --------------------------------------
  app.use('/images', express.static(service.config.outputDir, { index: false, dotfiles: 'ignore' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, providers: service.registry.all().map((p) => ({ id: p.id, configured: p.isConfigured() })) });
  });
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      [
        'imagen: local image generation server',
        '',
        `MCP (Streamable HTTP): ${opts.publicUrl}/mcp`,
        `A2A agent card:        ${opts.publicUrl}/${AGENT_CARD_PATH}`,
        `A2A JSON-RPC:          ${opts.publicUrl}/a2a`,
        `Generated images:      ${opts.publicUrl}/images/<file>`,
        `Health:                ${opts.publicUrl}/health`,
      ].join('\n'),
    );
  });
  return app;
}

export function listen(app: express.Express, opts: HttpOptions): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(opts.port, opts.host, () => resolve(server));
    server.on('error', reject);
  });
}
