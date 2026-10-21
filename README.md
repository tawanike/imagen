# imagen

A small, local image-generation server for coding agents. It exposes the same
generation pipeline two ways so any agent can use it:

- **MCP** (stdio or Streamable HTTP) for Claude Code, Codex, Cursor, etc.
- **A2A** (Agent-to-Agent, v1.0 with v0.3 compatibility) so other agents can delegate image work to it.

Behind both sits a pluggable provider layer:

| Provider | Models | Env |
| --- | --- | --- |
| `gemini` | Nano Banana 2.1 (`gemini-nano-banana-2.1`), Nano Banana Pro (`gemini-3-pro-image`), Nano Banana 2 / 2 Lite, legacy `gemini-2.5-flash-image` | `GEMINI_API_KEY` |
| `openai` | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` | `OPENAI_API_KEY` |
| `azure` | Any Azure AI Foundry image deployment: `gpt-image-*` via the Image API, FLUX.2 pro/flex via the Black Forest Labs route, FLUX 1.1 / Kontext via either | `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, `AZURE_FOUNDRY_DEPLOYMENTS` |

Every generated image is written to disk (default `~/.imagen/images`, or any
project folder you pass as `output_dir`) and logged to a `manifest.jsonl`, so
agents get back file paths rather than megabytes of base64.

## Quick start

```bash
git clone git@github.com:tawanike/imagen.git
cd imagen
pnpm install && pnpm build
cp .env.example .env     # add at least one API key
node dist/index.js models
node dist/index.js generate "flat vector icon of a smart kitchen scale, teal on white" -m nano-banana -a 1:1
```

Env files are read from `$IMAGEN_ENV_FILE`, `./.env`, then `~/.imagen/.env`
(real environment variables always win). Put your keys in `~/.imagen/.env`
once and every project can use the server.

## Use from Claude Code

**stdio (simplest, per-project or global):**

```bash
claude mcp add imagen --scope user -- node /ABSOLUTE/PATH/TO/imagen/dist/index.js mcp
```

**HTTP (one shared daemon, also serves A2A):**

```bash
node dist/index.js serve            # http://127.0.0.1:4747
claude mcp add --transport http imagen http://127.0.0.1:4747/mcp
```

Or drop [`examples/mcp.json`](examples/mcp.json) into a project as `.mcp.json`.
Then in a session:

> Use the imagen MCP to generate a 16:9 hero image for the landing page and save it to `public/hero.png`.

### Tools

| Tool | Purpose |
| --- | --- |
| `generate_image` | Text-to-image. Accepts `model`, `n`, `aspect_ratio`, `size`, `quality`, `seed`, `output_format`, `background`, `output_dir`, `filename`, `reference_images`, `extra`, `return_image`. |
| `edit_image` | Same as above with `reference_images` required; edits, restyles or combines existing images. |
| `list_models` | Providers, models, aliases and which ones have credentials. |
| `list_recent_images` | Newest entries from the output manifest. |

Model ids are `provider/model` (`openai/gpt-image-2`, `azure/FLUX.2-pro`) or an
alias: `nano-banana`, `nano-banana-pro`, `banana-lite`, `gpt-image`,
`gpt-image-mini`. Omit `model` to use `IMAGEN_DEFAULT_MODEL`, else the first
configured provider.

Set `return_image: true` to get the image bytes inline as MCP image content
(useful when the agent needs to look at the result); otherwise the tool returns
a JSON summary plus `resource_link` entries pointing at the files.

## Use from another agent (A2A)

With `imagen serve` running:

- Agent card: `http://127.0.0.1:4747/.well-known/agent-card.json`
- JSON-RPC endpoint: `http://127.0.0.1:4747/a2a` (v1.0 `SendMessage` / `SendStreamingMessage`; v0.3 `message/send` also accepted)

A request message can contain:

- text parts: the prompt
- a data part (`application/json`) with parameters: `{ "model", "n", "aspectRatio", "size", "quality", "seed", "outputFormat", "background", "outputDir", "filename", "extra" }`
- file parts (raw bytes or URLs) with an `image/*` media type: reference images for editing

The task completes with one `images` artifact containing each image as raw
bytes, a URL under `/images/…` on this server, and a `result.json` data part
with paths and timing.

```bash
curl -s -X POST http://127.0.0.1:4747/a2a -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"a red fox in an autumn forest"},{"data":{"model":"nano-banana","aspectRatio":"16:9"}}]}}}'
```

## CLI

```
imagen mcp                      # MCP over stdio
imagen serve [-p 4747] [-H 127.0.0.1]
imagen generate <prompt> [-m model] [-n 2] [-a 16:9] [-s 2K] [-q high] [-f jpeg] [-o ./assets] [-r ref.png ...] [--seed 42] [--transparent] [--json]
imagen models
```

## Provider notes

**Gemini.** Uses the Interactions API (the GA path for Nano Banana 2.x and
Pro); `gemini-2.5-flash-image` falls back to `generateContent`. `quality`
maps to `thinking_level` (`low` → minimal, `high` → high). `size` accepts
`512`, `1K`, `2K`, `4K` or a `WxH` that is bucketed into those. `extra`
supports `{ "googleSearch": true }` for grounding and
`{ "previousInteractionId": "…" }` for multi-turn editing.

**OpenAI.** `aspect_ratio` maps to `1024x1024` / `1536x1024` / `1024x1536`;
pass `size` directly for other values that the model supports. `background:
"transparent"` works on gpt-image-1 and 1.5 only. A Codex CLI / ChatGPT login
cannot be used for the Images API; you need an API key.

**Azure AI Foundry.** `AZURE_FOUNDRY_DEPLOYMENTS` lists your deployment names.
FLUX.2 deployments are routed to the Black Forest Labs provider API
(`/providers/blackforestlabs/v1/<model-path>`), which accepts `seed`,
`guidance`, `steps`, `safety_tolerance` through `extra`. Everything else uses the
OpenAI-compatible Image API at `<endpoint>/openai/v1/images/generations`.
Append `:bfl` or `:openai` to a deployment name to force a route. Only API-key
auth is implemented today (no Entra ID yet).

## Development

```bash
pnpm dev models          # run from source with tsx
pnpm test                # vitest
pnpm typecheck
```

Layout:

```
src/index.ts        CLI (mcp | serve | generate | models)
src/service.ts      generation façade shared by all front-ends
src/registry.ts     provider lookup + model/alias resolution
src/providers/      gemini.ts, openai.ts, azure.ts
src/mcp/server.ts   MCP tools
src/a2a/agent.ts    A2A agent card + executor
src/http.ts         express host: /mcp, /a2a, /.well-known/agent-card.json, /images
src/storage.ts      file naming + manifest.jsonl
```

Adding a provider means implementing the `ImageProvider` interface in
`src/types.ts` and registering it in `ProviderRegistry.fromConfig`.

## License

MIT
