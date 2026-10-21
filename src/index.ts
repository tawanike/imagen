#!/usr/bin/env node
import { Command } from 'commander';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getConfig } from './config.js';
import { createApp, listen } from './http.js';
import { createMcpServer } from './mcp/server.js';
import { ImagenService } from './service.js';
import { errorMessage } from './util.js';

const program = new Command();
program.name('imagen').description('Local image-generation server (MCP + A2A) over Gemini, OpenAI and Azure AI Foundry').version('0.1.0');

program
  .command('mcp')
  .description('Run the MCP server over stdio (for `claude mcp add`)')
  .action(() => {
    const service = new ImagenService(getConfig());
    serveStdio(() => createMcpServer(service), { onerror: (err) => console.error('[imagen mcp]', err.message) });
    console.error(`[imagen] MCP stdio server ready. Providers: ${describeProviders(service)}`);
  });

program
  .command('serve')
  .description('Run the HTTP server: MCP at /mcp, A2A at /a2a, images at /images')
  .option('-p, --port <port>', 'port (default IMAGEN_PORT or 4747)')
  .option('-H, --host <host>', 'bind host (default IMAGEN_HOST or 127.0.0.1)')
  .action(async (flags: { port?: string; host?: string }) => {
    const config = getConfig();
    if (flags.port) config.port = Number(flags.port);
    if (flags.host) config.host = flags.host;
    if (flags.port || flags.host) config.publicUrl = process.env.IMAGEN_PUBLIC_URL ?? `http://${config.host}:${config.port}`;
    const service = new ImagenService(config);
    const app = createApp(service, config);
    await listen(app, config);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(config.host)) {
      console.warn(`WARNING: bound to ${config.host}. imagen has no authentication; anyone who can reach this port can spend your API credits.`);
    }
    console.log(`imagen listening on ${config.publicUrl}`);
    console.log(`  MCP:    ${config.publicUrl}/mcp`);
    console.log(`  A2A:    ${config.publicUrl}/.well-known/agent-card.json`);
    console.log(`  Images: ${config.outputDir}`);
    console.log(`  Providers: ${describeProviders(service)}`);
  });

program
  .command('generate')
  .alias('gen')
  .description('Generate an image from the command line')
  .argument('<prompt...>', 'text prompt')
  .option('-m, --model <model>', 'model id or alias')
  .option('-n, --count <n>', 'number of images', '1')
  .option('-a, --aspect <ratio>', 'aspect ratio, e.g. 16:9')
  .option('-s, --size <size>', 'size, e.g. 1024x1024 or 2K')
  .option('-q, --quality <q>', 'low | medium | high | auto')
  .option('-f, --format <fmt>', 'png | jpeg | webp')
  .option('-o, --out <dir>', 'output directory')
  .option('--name <base>', 'base filename')
  .option('-r, --ref <path...>', 'reference image path(s) or URL(s)')
  .option('--seed <seed>', 'seed (FLUX)')
  .option('--transparent', 'transparent background (OpenAI gpt-image-1/1.5)')
  .option('--json', 'print JSON result')
  .action(async (promptWords: string[], flags: Record<string, string | string[] | boolean | undefined>) => {
    const service = new ImagenService(getConfig());
    try {
      const outcome = await service.generate({
        prompt: promptWords.join(' '),
        model: flags.model as string | undefined,
        n: Number(flags.count ?? 1),
        aspectRatio: flags.aspect as string | undefined,
        size: flags.size as string | undefined,
        quality: flags.quality as never,
        outputFormat: flags.format as never,
        outputDir: flags.out as string | undefined,
        filename: flags.name as string | undefined,
        referencePaths: flags.ref as string[] | undefined,
        seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
        background: flags.transparent ? 'transparent' : undefined,
      });
      if (flags.json) {
        console.log(JSON.stringify({ model: outcome.qualified, durationMs: outcome.durationMs, text: outcome.text, files: outcome.saved }, null, 2));
      } else {
        console.log(`${outcome.qualified} (${outcome.durationMs ?? '?'} ms)`);
        for (const s of outcome.saved) console.log(s.path);
        if (outcome.text) console.log(`\n${outcome.text}`);
      }
    } catch (err) {
      console.error(`error: ${errorMessage(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('models')
  .description('List providers, models and configuration status')
  .action(() => {
    const service = new ImagenService(getConfig());
    for (const p of service.registry.all()) {
      console.log(`${p.isConfigured() ? '✔' : '✖'} ${p.id}  ${p.name}${p.isConfigured() ? '' : `\n    ${p.configurationHint()}`}`);
      for (const m of p.models()) {
        console.log(`    ${p.id}/${m.id}${m.aliases?.length ? `  (${m.aliases.join(', ')})` : ''}`);
        console.log(`        ${m.description}`);
      }
    }
    console.log(`\noutput dir: ${service.config.outputDir}`);
    if (service.config.defaultModel) console.log(`default model: ${service.config.defaultModel}`);
  });

function describeProviders(service: ImagenService): string {
  return service.registry.all().map((p) => `${p.id}=${p.isConfigured() ? 'ok' : 'unconfigured'}`).join(' ');
}

program.parseAsync(process.argv).catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
