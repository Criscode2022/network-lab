# NetBench

Browser network lab for a junior network and systems administrator — plus **Eve**, a Vercel eve instructor agent.

**Continuing this repo (coding agents):** read [`HANDOFF.md`](./HANDOFF.md) first. It covers architecture, UI modes (Basic / mobile / desktop), Eve, deploy URLs, and what not to regress.

Not Packet Tracer. Not a CCIE catalog. Eight stable device kinds, three realistic switch profiles, dual-stack IPv4/IPv6, honest drops.

## Apps

| Path | What |
| --- | --- |
| `apps/web` | Angular + Tailwind canvas, terminals, packet inspector, Eve drawer |
| `apps/api` | NestJS lab engine, auth, lab CRUD, WebSockets, Eve tool API |
| `apps/eve-agent` | Vercel eve project (`eve deploy`) |
| `packages/engine` | Discrete-event simulator (import this in tests) |

## Device palette

Workstation (eth0+wlan0), Server, Switch (8×Gi), Router (4-port), Firewall (4-port), Access Point, thin WLC, Cloud/Internet stub.

Switch has three palette profiles while remaining one backward-compatible `switch` kind:
- **Unmanaged** — plug-and-play MAC learning and forwarding; no CLI, VLANs, IP, DHCP, or routing.
- **Managed L2** — access/trunk VLANs, native VLAN, RSTP-lite, MAC table, and management SVI.
- **Multilayer L3** — managed-L2 features plus `ip routing`, routed ports, SVI routing, static routes, DHCP pools/exclusions, and `ip helper-address`.

## Local run

```bash
cp .env.example .env
npm install
npm test -w @netbench/engine
npm test -w @netbench/api
# terminal 1
npm run start:dev -w @netbench/api
# terminal 2
npm start -w @netbench/web
# terminal 3 (optional)
npm run dev -w @netbench/eve-agent
```

- UI: http://localhost:4200
- API: http://localhost:3001/api/health
- Eve: `eve dev` (needs `AI_GATEWAY_API_KEY` locally; on Vercel use OIDC + AI Gateway — **no raw provider keys**)

Guest mode works without an account; the lab is saved in this browser and restored on reload. Sign in to keep it on your account and other devices. Email/password and magic-link tokens are implemented (magic link is returned by the API when email sending is not configured).

## Built-in labs

The curriculum has **48 labs** in two groups:
- **22 Models** are complete reference networks that pass Check as shipped.
- **26 Exercises** are intentionally broken or incomplete, expose progressive hints, and carry an official solution patch that makes Check pass.

Switch-specific models cover unmanaged bridging, managed-L2 VLAN trunks and management SVIs, multilayer inter-VLAN routing, local DHCP, and remote DHCP relay. Paired exercises cover endpoint faults behind an unmanaged switch, trunk allow-lists, missing `ip routing`, a wrong DHCP pool network, and a missing helper address.

Every lab has a **Check** with exact failure reasons, and **Troubleshoot** explains where and why a packet was dropped.

## Command cheat sheet

Open **Command reference** in the UI, or `help` in a node terminal. Linux: `ip addr add|del`, `ip route add|del|replace`, `ping`/`ping6`, `traceroute`, `nmcli wifi connect`, `dhclient`, `ssh`, `dig`. Managed switches and routers use a small Cisco-like subset. Multilayer switches add `ip routing`, `no switchport`, static routes, DHCP pools/exclusions and DHCP relay. Unknown or profile-inappropriate commands fail honestly.

## Simulator overview

See `docs/architecture.md`. Forwarding is real (MAC, 802.1Q, ARP/NDP, static, OSPFv2 area 0, DHCP, SLAAC, ACL, NAT, simplified Wi-Fi BSS). Eve **reads the engine** via Nest tools; it does not invent a topology.

Lab JSON schema: `packages/engine/schema/lab.schema.json`.

## Deploy

**Split is required:** the forwarding engine is a long-running Node process (not a 10s serverless timeout).

1. **Neon** — create a project, run `sql/schema.sql`, set `DATABASE_URL`.
2. **API** — Railway / Fly / Render / any always-on Node ≥ 24 (the image also builds eve, which refuses older Node). `apps/api/Dockerfile`. Env: `PORT`, `JWT_SECRET`, `DATABASE_URL`.
   Live: `https://api-production-caeb.up.railway.app/api/health` — the response must carry `version` and `eveTools: true`; if not, the running build is stale. Railway currently has **no GitHub push trigger** (the Railway GitHub App lost access to the repo), so deploys are triggered by hand — runbook in `HANDOFF.md` §11.1.
3. **Angular** — Vercel. Live: `https://netbench-www-criscode2022s-projects.vercel.app/`
   Off localhost the UI calls the Railway API. Railway nginx (`https://web-production-033453.up.railway.app/`) is a public fallback.
4. **Eve** — from `apps/eve-agent`. Preferred: Vercel (`eve link` / `eve deploy`, OIDC + AI Gateway). Self-host: `apps/eve-agent/Dockerfile` on a long-running Node host (`eve build && eve start`). Off localhost, tools call `https://api-production-caeb.up.railway.app`.

```bash
cd apps/eve-agent
npx eve link
npx eve deploy
# or: npx eve build && npx eve start --host 0.0.0.0 --port 8080
```

On Vercel: OIDC + AI Gateway (`minimax/minimax-m3`; Sonnet is blocked on the Gateway free tier). Locally: `AI_GATEWAY_API_KEY`. Set `NETBENCH_API_URL` to the public Nest URL.

Health:
- API `GET https://api-production-caeb.up.railway.app/api/health`
- Eve `GET https://netbench-eve-criscode2022s-projects.vercel.app/eve/v1/health` (`{"ok":true,"status":"ready"}`)
- Angular `https://netbench-www-criscode2022s-projects.vercel.app/`
