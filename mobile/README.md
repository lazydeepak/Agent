# Agent Mobile Client (scaffold)

This directory is a scaffold for mobile clients (iOS/Android) that consume Agent's
optional remote HTTP control API. The desktop sources are not modified; mobile
clients talk to `agent service start` over the loopback/remote API.

## Prerequisites
- Start the remote API: `npm run relay -- service start` (requires `RELAY_REMOTE_TOKEN`).
- Default bind is loopback; non-loopback requires explicit opt-in.

## Endpoints (see `src/remote/remote-server.ts`)
- `GET /health` — readiness.
- `GET /status` — runtime status summary.
- `GET /timeline` — recent events.
- `POST /start-project`, `POST /pause-project` — project control.
- `GET /events` — event stream.
- `GET /attention`, `POST /attention` — attention items.
- `GET /attention/proposals`, `POST /attention/proposal`, `POST /attention/proposal/approve`, `POST /attention/proposal/reject` — AI proposal flow.
- `POST /dispatch` — dispatch.

## Client SDK
A minimal TypeScript client is provided in `client.ts` for mobile / web
consumption. Native iOS/Android implementations should mirror its contract.

## Security
- Bearer token in `Authorization: Bearer <RELAY_REMOTE_TOKEN>`.
- Compare tokens in constant time (server-side).
- Never store tokens in plaintext on device; use Keychain/Keystore.
