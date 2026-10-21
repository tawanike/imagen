# Security policy

## Supported versions

imagen is pre-1.0. Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/tawanike/imagen/security/advisories/new).

Include what you found, how to reproduce it, and the impact you foresee. You can expect an
acknowledgement within a few days and a fix or mitigation plan as soon as we've confirmed the issue.
We're happy to credit you in the release notes if you'd like.

## Scope and threat model

imagen is a **local developer tool**. It has no authentication and is designed to listen on loopback only.

In scope:

- Bypasses of the Host/Origin guard (DNS rebinding, cross-site requests)
- Path traversal or arbitrary file access beyond what `output_dir` / `reference_images` intentionally allow
  for a trusted local caller, including through the `/images` static route
- Leaking API keys through logs, errors, manifests, output files or HTTP responses
- Dependency vulnerabilities that are reachable in normal use

Out of scope:

- Risks that require the user to bind to a non-loopback address and expose the port (the server warns
  about this at start-up)
- Denial of service by a user who already has local access
- Issues in the upstream provider APIs themselves

## For users

- Keep API keys in `~/.imagen/.env` or your environment, never in a repository or a committed `.mcp.json`.
- Don't set `IMAGEN_HOST` to a public address without an authenticating proxy in front.
- Rotate any key you think has leaked.
