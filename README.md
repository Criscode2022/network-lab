# NetBench

Browser network lab for a junior network and systems administrator — plus **Eve**, a Vercel eve instructor agent.

**Continuing this repo (coding agents):** read [`HANDOFF.md`](./HANDOFF.md) first. It covers architecture, UI modes (Basic / mobile / desktop), Eve, deploy URLs, and what not to regress.

Not Packet Tracer. Not a CCIE catalog. Eight device types, dual-stack IPv4/IPv6, honest drops.

## Apps

| Path | What |
| --- | --- |
| `apps/web` | Angular + Tailwind canvas, terminals, packet inspector, Eve drawer |
| `apps/api` | NestJS lab engine, auth, lab CRUD, WebSockets, Eve tool API |
| `apps/eve-agent` | Vercel eve project (`eve deploy`) |
| `packages/engine` | Discrete-event simulator (import this in tests) |

## Device palette

Workstation (eth0+wlan0), Server, L2 Switch (8×Gi), Router (4-port), Firewall (4-port), Access Point, thin WLC, Cloud/Internet stub.

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

Fault labs (★) start broken and tell you what to repair; study labs work as shipped.

1. ★ Plug in the cable  
2. ★ Give PC2 an address  
3. ★ Turn the port on  
4. First IPv4 ping  
5. Missing gateway / wrong mask  
6. ★ Find the fault: wrong subnet mask  
7. VLANs + router-on-a-stick  
8. DHCPv4  
9. Dual-stack SLAAC + ping6  
10. OSPF area 0  
11. Wi-Fi associate + DHCP + ping wired server  
12. Firewall: block SSH from wifi VLAN, allow from wired jump host  
13. ★ Two routers, static routes  
14. ★ OSPF across three routers  
15. ★ Out to the Internet with NAT  
16. ★ Wi-Fi with a controller (WLC)  
17. Capstone: dual-stack office  

Each has a **Check** with exact fail reasons, and **Troubleshoot** explains where and why a packet is dropped.

## Command cheat sheet

Open **Command reference** in the UI, or `help` in a node terminal. Linux: `ip addr add|del`, `ip route add|del|replace`, `ping`/`ping6`, `traceroute`, `nmcli wifi connect`, `dhclient`, `ssh`, `dig`. Switch/router: tiny Cisco-like subset (`show run`, VLANs, trunks, `ip route` / `no ip route`, OSPF area 0, NAT overload, DHCP pool). Unknown commands fail honestly.

## Simulator overview

See `docs/architecture.md`. Forwarding is real (MAC, 802.1Q, ARP/NDP, static, OSPFv2 area 0, DHCP, SLAAC, ACL, NAT, simplified Wi-Fi BSS). Eve **reads the engine** via Nest tools; it does not invent a topology.

Lab JSON schema: `packages/engine/schema/lab.schema.json`.

## Deploy

**Split is required:** the forwarding engine is a long-running Node process (not a 10s serverless timeout).

1. **Neon** — create a project, run `sql/schema.sql`, set `DATABASE_URL`.
2. **API** — Railway / Fly / Render / any always-on Node. `apps/api/Dockerfile`. Env: `PORT`, `JWT_SECRET`, `DATABASE_URL`.
   Live: `https://api-production-caeb.up.railway.app/api/health`
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
