# strata-router

[中文](README.md) | English

A single entry point and admin console for several machines running [Strata](https://github.com/Niko1221/Strata). Point your clients (Claude Code, OpenAI-compatible clients, etc.) at the router and requests are spread across the nodes. The API is the same as Strata's (`/v1/messages`, `/v1/chat/completions`, `/v1/models`, ...). The OpenAI Responses API (`/v1/responses`) is also supported: the router converts it to Chat Completions for the nodes.

## Features

- **Sticky sessions**: a session is identified by its system prompt plus first user message and goes back to its previous node, reusing the KV cache there.
- **Moving when busy**: when the home node is busy, the router estimates how many tokens an idle node would have to re-read (excluding the system prompt and tools it already cached). It moves the session if that is under a threshold, otherwise it queues.
- **Strategies**: even, least load, random, weighted. Nodes can be enabled, drained or disabled; failed connections are retried on another node.
- **Access keys**: multiple keys that can be enabled, disabled and renamed, with daily and total usage.
- **Console** (`/admin`): overview, nodes (hardware metrics, live request progress, engine config), request log with routing decisions, keys, settings. Light / dark theme, Chinese / English.

## Screenshots

Generated with simulated nodes and sample data.

![Overview](docs/screenshots/overview.png)

![Nodes](docs/screenshots/nodes.png)

![Node detail](docs/screenshots/node-detail.png)

![Request detail](docs/screenshots/request-detail.png)

![Dark theme](docs/screenshots/overview-dark.png)

## Running

The backend uses only the Python standard library (3.9+). Build the console first:

```bash
cd web && pnpm install && pnpm build && cd ..
cp config.example.json config.json   # fill in node URLs and each node's own api_key
cd backend && python3 -m strata_router ../config.json
```

It listens on `0.0.0.0:8099` by default. On first start it generates an initial admin password in `initial-admin-password.txt` next to the config file (readable only by you). Sign in at `http://<host>:8099/admin` and change it under Settings. An `api_key` in the config is migrated to an access key named "默认" (default) on first start; manage keys in the console afterwards. Nodes can also be added in the console.

For a long-running service, see `deploy/strata-router.service.example` (systemd user service).

## Tests

```bash
cd backend && python3 -m unittest discover tests -v
```

Tests run against simulated Strata nodes; no real machines needed.

## Layout

```
backend/strata_router/   backend (entry and forwarding, nodes and routing, storage, admin API, Responses conversion)
backend/tests/           backend tests
web/                     console frontend
deploy/                  systemd service template
docs/                    requirements, plans, changelog and screenshots (Chinese)
```

## License

[MIT](LICENSE)
