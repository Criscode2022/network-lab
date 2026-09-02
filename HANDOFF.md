# NetBench — agent handoff

Read this file before changing code. It is the continuation brief for another coding agent: product rules, architecture, how to run and deploy, UI modes, Eve, tests, recent work, and what not to break.

Last updated: 2026-09-01 (UI overhaul + Focus mode). Repo: `https://github.com/Criscode2022/network-lab` (public). Default branch: `main`.

---

## 1. What this is

NetBench is a **browser network lab for junior net/sysadmins**. Users draw a wired/wireless topology, configure IPv4/IPv6, run a per-node CLI, inspect packets with honest drop reasons, save labs, and ask **Eve** (Vercel eve agent) to explain / fix / build — with HITL confirm before mutations.

It is **not** Packet Tracer and **not** a CCIE catalog.

### Hard product constraints (do not violate)

- **Exactly eight device kinds:** `workstation`, `server`, `switch`, `router`, `firewall`, `ap`, `wlc`, `cloud`.
- **No BGP, MPLS, VXLAN, or 802.1X.** Requests for those must fail honestly (HTTP 400 / CLI error). OSPF is **area 0 only**.
- The **engine is source of truth**. Angular never invents forwarding. Eve tools call Nest, which calls `Engine`.
- Drops must keep an **honest reason** (packet inspector + `get_path`). Do not fake success.
- Approximations (SSH crypto, RF, OSPF P2P) are marked **simulated**.
- Eve mutations are always authorised by a host-minted `confirmToken`; the human Approve click is optional (auto-approve is the default since the Eve upgrade — `EVE_REQUIRE_APPROVAL=1` / the drawer switch bring it back).
- The forwarding engine is a **long-running Node process**. Do not put it on a 10s serverless timeout.
- Palette is junior-admin only. Wired cables: Ethernet (auto-MDIX), straight-through, crossover, fiber. Wi-Fi is a simplified BSS then IP. No console/serial.

---

## 2. Live URLs

| Piece | URL |
| --- | --- |
| **Angular app (use this)** | https://netbench-www-criscode2022s-projects.vercel.app/ |
| Eve agent | https://netbench-eve-criscode2022s-projects.vercel.app |
| Eve health | https://netbench-eve-criscode2022s-projects.vercel.app/eve/v1/health → `{"ok":true,"status":"ready"}` |
| Nest API | https://api-production-caeb.up.railway.app/api |
| API health | https://api-production-caeb.up.railway.app/api/health |
| API WebSocket | `wss://api-production-caeb.up.railway.app/ws?sessionId=…` |
| Railway nginx fallback (older web image) | https://web-production-033453.up.railway.app/ |

GitHub production Vercel checks on `main` also exist for extra project names (`netbench-web`, `netbench-lab`, `netbench-app`, `netbench-angular`, `netbench`). The **canonical UI** is `netbench-www`.

After UI commits, tell the user the Angular URL and that they may need a hard refresh.

---

## 3. Monorepo layout

```
network-lab/
  packages/engine/     @netbench/engine — discrete-event simulator (vitest)
  apps/api/            @netbench/api — NestJS REST + WS (vitest)
  apps/web/            @netbench/web — Angular 22 standalone + Tailwind v4
  apps/eve-agent/      Vercel eve project (defineAgent / defineTool)
  docs/                architecture.md, commands.md, lab.schema.json
  sql/schema.sql       Neon tables
  HANDOFF.md           this file
  README.md            short human overview
```

npm workspaces. Node >= 20. Root `npm install`.

---

## 4. Data flow

```
Angular workspace  --REST+WS-->  Nest SimService  -->  Engine (one per session)
Eve drawer (browser) --NDJSON-->  Vercel Eve host  --HTTP-->  Nest /api/eve/tools/*
Mutating Eve tools: (optional HITL Approve)  then  host mints Nest confirmToken  then  apply
```

- Localhost Angular uses `/api` and `ws://host/ws` via `apps/web/proxy.conf.json` → `127.0.0.1:3001`.
- Production Angular uses Railway `https://api-production-caeb.up.railway.app/api` and `wss://…/ws`.
- Production Eve host is **Vercel**, not Railway `/eve` (that proxy 404s for anonymous browser guests). See `apps/web/src/app/eve-client.ts` `EVE_HOST`.
- Eve stream is NDJSON (`message.appended/completed`, `input.requested` HITL, `step.failed`).

---

## 5. Engine (`packages/engine`)

Pure TypeScript. Import in tests: `@netbench/engine`.

| File | Role |
| --- | --- |
| `src/engine.ts` | Discrete-event forwarding, CLI `exec`, ping, path, check |
| `src/devices.ts` | `createDevice`, iface defaults (`adminUp` false on Cisco until no-shut) |
| `src/types.ts` | `DeviceKind`, `KIND_PORTS`, `CableMedia`, `LabJson`, `LabPatch`, checks |
| `src/cables.ts` | Cable types, like/unlike pairing, fiber SFP check |
| `src/labs.ts` | Seventeen builtin labs (fault labs start broken; see the curriculum test) |
| `src/build.ts` | `labFromSpec(spec)` for Eve Builder |
| `src/patch.ts` | Validate/apply `LabPatch` |
| `src/ip.ts` | IPv4/IPv6 helpers |
| `src/commands.ts` | Per-kind `help` text |
| `schema/lab.schema.json` | Lab JSON schema |
| `test/engine.test.ts` | ~48 tests; run twice before calling engine “done” |

### Builtin curriculum (17)

Order = difficulty. **Fault labs** (`lab-0a-plug-the-cable`, `lab-0b-first-address`, `lab-0c-port-shutdown`, `lab-2b-wrong-mask`, `lab-9-static-routes`, `lab-10-ospf-three-routers`, `lab-11-nat-internet`, `lab-12-wlc-capwap`) ship with a failing Check and a goal that names the repair; the test `fault labs fail as shipped and pass after the documented fix` holds the fix commands — update it when you add a fault lab. Study labs (`lab-1` … `lab-8`, `lab-13-dual-stack-office`) pass as shipped. `LAB_CAPSTONE` reuses `dualStackOfficeLab()` from `build.ts` (labs.ts imports build.ts; build.ts must not import labs.ts). Device coordinates assume ~112×110 px cards: keep ≥ 140 px between rows.

### CLI additions (route / address removal)

- Linux: `ip route del default [via GW]`, `ip route del CIDR`, `ip route replace|change default via GW`, `ip addr del CIDR dev IF`, `ip addr flush dev IF`. `ip route add default` now fails with `RTNETLINK answers: File exists` when a static default exists (Linux behaviour) — use `replace`. Deleting an IPv4 prunes static routes whose next hop left every connected subnet (`pruneUnreachableRoutes`) and clears `defaultGw4`.
- Cisco: `no ip route NET MASK [NH]` (`0.0.0.0 0.0.0.0` = default), `no ip address` / `no ipv6 address` in interface mode, `no ip default-gateway`; `shut` alias.
- AP / WLC: `int` abbreviation and per-interface `shutdown` / `no shutdown` (labs 7/8/12 use `int Gi0/1`, `int wlan0`). A bare `no shutdown` on an AP still enables radio + uplink together. The engine test replays every builtin startup line and fails on any `% Unknown command`.

### Ports

```
workstation: eth0, wlan0
server:      eth0, eth1
switch:      Gi0/1 … Gi0/8
router:      Gi0/0 … Gi0/3
firewall:    eth0 … eth3
ap:          Gi0/1, wlan0
wlc:         Gi0/1
cloud:       eth0
```

Linux hosts (`workstation`, `server`, plus firewall/cloud CLI): `ip addr add`, `ip link set`, `ping`, `nmcli wifi connect`, `dhclient`, `ssh`, …
Cisco-like (`switch`, `router`, `ap`, `wlc`): start at **user** exec; need `enable` then `conf t`. `operUp` requires `adminUp` **and** a peer (or radio assoc).

**Important:** `Engine.addLink` now sets `adminUp = true` on both ends. The first lab only `no shut`s Gi0/1 and Gi0/2 in startup; a third PC used to land on Gi0/3 still shutdown. Do not revert that without replacing it.

`addLink` rejects an occupied port (`already cabled`). Optional 4th arg / patch field `cable`: `ethernet` (default, auto-MDIX, always gets carrier), `straight`, `crossover`, `fiber`. Straight/crossover follow CCNA like/unlike rules (switch is the only intermediary). Wrong type still creates the cable but `operUp` is false (`Wrong cable`). Fiber is refused on workstation/server/cloud (no SFP). `getState` ifaces include `peer`, `status`, `statusReason`.

### `labFromSpec(spec)`

Used by HTTP `POST /api/sessions/:id/build` and Eve `build_lab`. Must handle:

- Dual-stack office sentence (switch + router + AP + server + two PCs).
- OBJECTIVE-style: *“two VLANs, one router, wifi on VLAN 20, Linux server on VLAN 10, PC must ping the server via the router”* — count a **bare PC**, map `on VLAN N` **per role**, emit a ping Check.

Out of scope words (`bgp|mpls|vxlan|802.1x`) → 400.

### CLI / packets

- `engine.exec(deviceId, line)` returns `{ output, prompt, error, events }`.
- `engine.getPath(src, dst, proto, family)` — no silent drop; synthesize a drop event if needed.
- `engine.check()` — lab checks (`ping`, `wifi-associated`, `dhcp-bound`, `ospf-full`, …).
- Ping cancel: `engine.cancel()`; echo wait must not hang (`echoWait?.got`).
- Cisco parse: parse **router** before generic `ip` so `ip route` is not swallowed as Linux `ip`.

Run: `npm test -w @netbench/engine`

---

## 6. Nest API (`apps/api`)

Global prefix `/api`. CORS `origin: true`. Long-running: `tsx src/main.ts` (script `start` / `start:dev`).

| Area | Path |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/{register,login,guest,magic,magic/consume}` `GET /api/auth/me` |
| Labs | `GET /api/labs/builtin`, CRUD `/api/labs` |
| Session | `POST /api/sessions` → `{ sessionId, state }` |
| State | `GET /api/sessions/:id/state` |
| CLI | `POST /api/sessions/:id/cli` `{ deviceId, line }` |
| Check | `POST /api/sessions/:id/check` |
| Edit topology | `POST /api/sessions/:id/edit` `{ patch?, move? }` — **no** confirmToken (user UI) |
| Eve mutations | `POST /api/sessions/:id/{patch,config,build}` **require** `confirmToken` |
| Confirm | `POST /api/sessions/:id/confirm` `{ purpose }` |
| Eve tools | `POST /api/eve/tools/{confirm,get_lab_state,get_device,get_path,run_check,apply_device_config,apply_lab_patch,build_lab,highlight_devices,list_commands}` |
| WS | `GET /ws?sessionId=` (not under `/api`) |

`purpose` values: `apply_lab_patch`, `apply_device_config`, `build_lab`. Missing token → 403. Rate limit: 60 CLI/tool calls per minute per session.

DI: Nest ESM — inject with `@Inject(Class)` where needed. Do not assume string tokens.

### Persistence (`store.ts` + `db.ts`)

- Without `DATABASE_URL`: in-memory maps (tests / guest).
- With Neon: **SELECT users/labs on login/list/get** (not only cache), **await writes**. Schema: `sql/schema.sql`.
- Guests: JWT + banner; lab JSON autosaves to `localStorage.nb_guest_lab` and is restored on reload. Sign in to copy that lab onto the account.

### WebSocket (`create-app.ts`)

Persistent `/ws`. Messages: `{ type: 'cli', deviceId, line }`, `{ type: 'cancel' }`. Server pushes `{ type: 'cli', output, events, state }` and periodic `state`.

Railway image: `apps/api/Dockerfile` (monorepo context). `start.sh` also starts eve on `:4010` in-container; **browsers still must use the Vercel Eve host**.

Env: `PORT`, `JWT_SECRET`, `DATABASE_URL`, optional `EVE_ORIGIN`.

Run: `npm run start -w @netbench/api` → `http://127.0.0.1:3001/api/health`  
Tests: `npm test -w @netbench/api` (~24 tests).

---

## 7. Angular web (`apps/web`)

Angular **22** standalone + signals + Tailwind **v4**. **No zone.js** (zoneless). Native `addEventListener` (Safari `gesturechange`) must call `ChangeDetectorRef.detectChanges()` after `pan.set`.

| File | Role |
| --- | --- |
| `src/app/workspace.ts` | Canvas, pan/zoom, modes (Basic/Simple/Advanced/Focus), boot + session recovery, check panel, Reach (ping/trace), hints, undo, tidy-up, share links, auth, Eve bind |
| `src/app/workspace.html` | Template. Shared `ng-template`s: `#devicePanel` (Simple inspector + Basic sheet), `#reachPanel` |
| `src/app/api.ts` | HTTP/WS client, `PALETTE`, types, `online`/`wsConnected`, `attach()`, `snapshot()`, saved labs |
| `src/app/eve-client.ts` | Eve session + NDJSON stream + HITL |
| `src/app/terminal.ts` | `<nb-terminal>`: per-device tabs, history (↑/↓), Tab completion from the cheat sheet, quick commands (`QUICK_COMMANDS`) |
| `src/app/packets.ts` | `<nb-packets>`: packet list with filter/drops-only, detail card, activity Log tab |
| `src/app/lab-picker.ts` | `<nb-lab-picker>`: curriculum with pass badges + signed-in “My labs” |
| `src/app/cheat-sheet.ts` | `<nb-cheat-sheet>`: searchable command reference; click inserts into the terminal |
| `src/app/toasts.ts` | `<nb-toasts>`: info/success/warn/error with optional action (Undo) |
| `src/app/icons.ts` | `<nb-icon>` inline SVG set; `KIND_ICON` maps device kind → icon |
| `src/styles.css` | Tailwind v4 `@theme` tokens (`ink-*`, `brand-*`, `ok/warn/danger/eve`), component classes (`.btn*`, `.chip*`, `.field`, `.seg`, `.led*`, `.card`), `.grid-canvas` dot grid |
| `src/index.html` | `viewport-fit=cover`, Inter + JetBrains Mono, `favicon.svg` (in `public/`) |
| `proxy.conf.json` | `/api` `/ws` → :3001, `/eve` → :4010 |
| `vercel.json` | `outputDirectory: dist/web/browser`; SPA rewrite |

Route: `''` → `Workspace`. `App` is an inline `<router-outlet />` (the Angular starter `app.html` was removed).

### Boot order (`Workspace.boot()`)

1. `GET /labs/builtin`.
2. `#lab=<base64url JSON>` in the URL → open that lab (share link), then strip the hash.
3. Else `localStorage.nb_autosave.sessionId` (< 12 h) → `api.attach()` re-uses the still-running engine session (keeps ARP tables, hostnames, terminal state across reloads). 404 → fall through.
4. Else guest snapshot (`nb_guest_lab`) or `lab-1-first-ipv4-ping`.

Every UI action that changes a device (Add IP, Set gateway, enable/disable port, DHCP, Wi-Fi join, start SSH) runs real CLI lines through `runCommands()` and echoes them into that device’s terminal buffer, so the learner sees the command.

Local: `cd apps/web && npx ng serve --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.json`

### UI modes (read before touching the canvas)

| Mode | When | What |
| --- | --- | --- |
| **Desktop** (`innerWidth >= 768`) | md+ | Palette + canvas + inspector + terminal + packets. Eve header toggle. |
| **Full mobile** | narrow && `basic()` false | Tabs: Canvas / Palette / Inspect / Term / Eve. |
| **Basic mobile** | narrow && `basic()` true (**default** `localStorage.nb_basic !== '0'`) | Canvas only. Header: Check + **Basic on**. FAB **+ Add**. Tap device → bottom sheet. |
| **Simple vs Advanced** | `localStorage.nb_advanced === '1'` | **Simple:** device-to-device Ethernet (auto-MDIX), used ports + peer only, IPv4, hide IPv6/MAC/running-config. **Advanced:** cable types, port grid on cards, cable-end port labels, all ifaces, IPv6, MAC, inspector tabs Ports / Network / Config. Basic forces Advanced off. |
| **Focus** (desktop) | `localStorage.nb_focus === '1'`, header ⤢ button or `Shift+F` | Canvas only: thin header (lab picker, Check, connection dot, Exit focus), floating toolbar (Add ▾ / Cable / Terminal / Eve), zoom toolbar, compact chip for the selected device (first hint, Term / Reach / Cable / Details / Delete). Palette, inspector, Eve and footer hidden; the dock appears only via the Terminal toggle (`focusTerm`). `Details` leaves focus mode. |

`basicMode()` = `isNarrow() && basic()`; `focusMode()` = `focus() && !isNarrow()`. Desktop ignores Basic even if the flag is on. Desktop Simple vs Advanced is the main mode split. Cards/cables use `advUi()` = `advanced() && !basicMode()` so a phone in Basic never shows the port grid even if Advanced was on at desktop width. Eve starts open only at `innerWidth >= 1440` unless `nb_eve_open` says otherwise (at 1280 the four columns squeeze the canvas to ~440px).

### Desktop chrome

- **Header:** logo · `<nb-lab-picker>` (progress bar, pass badges, My labs) · Check (dot = last result) · Simple/Advanced · Focus · ⋯ menu (Save a copy, Reset lab, Tidy up, Copy share link, Copy/Download/Upload JSON, Command reference, Shortcuts, Help topics, Welcome tour, About) · Guest/Account · Eve.
- **Check panel** under the header: per-check pass/fail with the engine reason, “Next lab” on success, “Ask Eve why” on failure. Passing marks the lab in `nb_passed`. Fresh packets from the check are replayed hop by hop and lit as a trace.
- **Canvas overlays:** goal card with live checklist (top-left, collapsible), mode pill (placing/cabling), trace card (bottom-left; hops + honest reason; Esc or click empty canvas clears), link card, zoom toolbar (−/%/+/fit/tidy).
- **Inspector (Simple):** device header with LED, quick actions (Terminal / Reach / Cable / Explain / Delete), **Hints** (engine-state diagnostics with one-click fixes: enable port, enable the peer’s port, replace wrong cable, Add IP or DHCP, set/change gateway when missing, off-subnet or unowned, join Wi-Fi, start SSH), Connections, IPv4 (+ Add IP, DHCP, pencil = change address/mask via `ip addr del` + `add`, Cisco overwrite), Default gateway (Set / Change via `ip route replace` or `no ip route` + `ip route` / Remove), Wi-Fi (join from SSIDs parsed out of AP/WLC running-config), Reach (Ping via CLI or Trace via `POST /path`; result + hop chain; Watch).
- **Dock:** resizable (`nb_dock_h`) — `<nb-terminal>` left, `<nb-packets>` right (Packets | Log). Packet detail has “Show on canvas” (replay) and “Ask Eve why”.
- **Toasts** replace the old hint bar. Delete and Unplug toasts carry **Undo** (delete undo re-adds the device, its links and replays `startup`/`post` from the pre-delete `snapshot()`).

### Learning tools (all engine-driven)

- **Troubleshoot** (check panel, checklist “Why?”, Reach “Explain the drop”): runs `POST /path` for the failing ping/ssh check, takes the last `drop` event and passes its `reason` + `from.device` to `diagnose()`. That function is a regex table over the engine’s drop strings (`Interface X is administratively down`, `No cable on`, `Interface X is down`, `VLAN mismatch`, `No subinterface for VLAN`, `RSTP-lite blocking`, `ARP/NDP timeout for NH at DEV`, `No route to DST on DEV`, `No outgoing interface`, `DEV is not a router`, `TTL expired`, `ACL drop:`, `not associated`). It cross-checks device state (e.g. “no route” while the covering interface is down → L1, not gateway) and returns layer, plain-language detail, “look at”, verify commands and an optional one-click fix. Wi-Fi/DHCP/OSPF checks are read from the check reason (`diagnoseCheck`). Add a branch when the engine gains a new drop string; never infer forwarding the engine did not report.
- **Watch** (Reach panel): `startMonitor()` re-runs `POST /path` every 5 s (`MONITOR_MS`), updates the trace and stops with a toast when the path works. Each tick is one rate-limited call and adds packets to the engine log.
- **Checkpoints** (`nb_ckpt`, max 12): `snapshot()` stored per lab id. Diff compares engine-generated `startup`/`post` lines per device plus cable keys; Restore re-opens the lab (new session).
- **Lab editor** (⋯ → Edit name, goal & checks): edits `name/goal/description/checks` on a `snapshot()` and re-opens it. Builtin ids are replaced by `nb-<slug>-<rand>` so the curriculum entry stays pristine; the result appears in the picker as “(this browser)” with a pencil badge and can be shared via link.
- **Command palette** (`Ctrl+K`): actions, add-device, devices (select/terminal), labs. `buildPalette()` is the single list; keyboard ↑/↓/Enter.
- **View options** (`nb_view`): colour IPs by subnet (`subnetColors`, first-appearance order), VLAN role on Advanced cable labels (`Gi0/1 v10`, `Gi0/8 T`), packet animation on/off.
- **Packets “capture on device”**: `<nb-packets [focusDevice]>` toggle filters to packets whose `from`/`to` is the selected device.
- **Lab report**: `buildReport()` → Markdown (devices, addresses, gateways, cables, checks with last result, recent drops); copy or download.

### Canvas mechanics

- World layer: CSS `translate(pan.x, pan.y) scale(pan.s)`. SVG is **4000×3000+** so paths are not clipped on a ~390px phone. Do **not** size the SVG `inset-0 h-full w-full` (that was the missing-cable bug).
- Cables: SVG `<path>` from `linkPath`, anchored at `anchor(d)` = `(x + cardW()/2, y + 34)` where `cardW()` is 112 (Simple) / 132 (Advanced). Click a cable to inspect/unplug. Radio = dashed purple; fiber orange; crossover teal dashed; wrong-cable dimmed; trace-lit cables cyan (red if the trace dropped). Rubber-band while cabling. Packet dots animate one hop at a time (`animate()` dedupes event ids for 3 s because WS pushes and CLI replies both deliver them).
- The dot grid follows pan/zoom (`gridPos`/`gridSize` bound to `background-position/size`).
- `fitToView()` keeps the topology clear of the goal card and bottom toolbars and runs on load on desktop too.
- Pan: one pointer. Pinch: two pointers. Wheel zoom 0.35–2.4 around cursor. Safari `gesturestart/change/end` on the canvas (non-passive, `NgZone` not enough — use `cdr.detectChanges()`).
- `touch-action: none` on `.grid-canvas`. `setPointerCapture` wrapped in try/catch (synthetic events throw).
- Narrow: `fitToView()` after lab load / becoming narrow / add in Basic.

### Adding devices and cables

- Desktop palette: **Cables** (Ethernet always; Straight/Crossover/Fiber in Advanced) then device types. Click a cable to arm; click two devices (or two free ports in Advanced). Stays armed until Cancel/Escape.
- Mobile: `place(kind)` **auto-drops** at view center (`addDevice` + `dropPoint` + unique `PC3` names).
- Basic FAB **Cable** (left) + **+ Add** (right). Add sheet has Cable first, then `PALETTE`.
- **Cable:** `startCable` / `finishCable` pick first free non-radio iface (`freePort`). Advanced `clickPort` uses that exact port and refuses used ports. After a successful cable in Basic, reopen the sheet on the target device so ports update.
- `POST /sessions/:id/edit` `{ addDevices, addLinks: [{ a, b, cable? }], removeDeviceIds, removeLinks }` and `{ move: [{ id, x, y }] }`.

### Add IP

When a device has no IPv4 (`canAddIpv4`: not a switch): suggest next host on the busiest lab subnet (after the highest used host, e.g. .10 and .20 → **.21**). Apply via CLI:

- Linux: `ip addr add CIDR dev IF` then `ip link set IF up`
- Cisco: `enable`, `conf t`, `interface IF`, `ip address A.B.C.D MASK`, `no shutdown`, `end`

### Device names vs interface names

Each PC has its **own** `eth0`. Three PCs on one switch: `PC1:eth0→SW1:Gi0/1`, `PC2:eth0→SW1:Gi0/2`, `PC3:eth0→SW1:Gi0/3`. Do not “share” eth0.

### Inspector / Basic sheet

- Simple + Basic: **Used ports** (`usedPortRows`: name, Up/Wrong cable/Disabled, peer, Unplug). Free ports hidden behind “Show N free ports”. Then IPv4.
- Advanced inspector: every iface with peer, cable type, MAC, IPv6, running-config.
- Simple cards: `Gi0/1 → PC1` (used only). Advanced cards: port grid (filled = used, outline = free). Used ports on switch/router come from engine `iface.peer` (fallback: links).
- Basic sheet footer: Cable | Close | Delete (icon). Full-mobile inspector: “Back to canvas”. The sheet and the Simple inspector render the same `#devicePanel` template (`big` context flag switches to touch-size controls).

### localStorage keys

| Key | Meaning |
| --- | --- |
| `nb_basic` | `'0'` = full mobile UI; anything else / missing = Basic **on** for phones |
| `nb_advanced` | `'1'` = Advanced inspector/cards |
| `nb_token` | JWT (dropped at boot if `exp` passed; `Api.guest` is computed from the token’s `guest` claim) |
| `nb_autosave` | `{ id, sessionId, at }` — `boot()` re-attaches to `sessionId` if < 12 h old |
| `nb_guest_lab` | Guest lab JSON snapshot (`{ v:1, at, lab }`) restored on reload |
| `nb_eve:{userId}:{nestSessionId}` | Eve session id |
| `nb_eve_auto` | `'0'` = ask before applying Eve's tool calls (default auto-approve) |
| `nb_focus` | `'1'` = desktop Focus mode |
| `nb_eve_open` | `'1'`/`'0'` remembered Eve drawer state (default open only ≥ 1440px) |
| `nb_passed` | JSON array of lab ids whose Check passed (badges + progress bar) |
| `nb_welcome` | `'1'` = welcome tour dismissed |
| `nb_dock_h` | dock height in px |
| `nb_ckpt` | Checkpoints `[{ id, name, at, labId, lab }]` (max 12) |
| `nb_view` | `{ subnet, vlan, anim }` view options |

Share links: `#lab=<base64url(UTF-8 JSON)>` of `snapshot()`; opened labs are copied into the guest snapshot. “Save a copy” (`POST /labs`) mints a fresh `nb-…` id so it never collides with a builtin id.

### Screenshots

Do **not** commit `netbench-*.png` (root `.gitignore`). Playwright MCP writes those in the repo root during verification.

---

## 8. Eve (`apps/eve-agent`)

eve **0.47.x**. `defineAgent({ model })` only — **no `name`**. Sandbox: just-bash locally; Vercel sandbox on Vercel.

- Model config is shared in `agent/lib/model.ts` and spread into the root agent and every subagent (`...modelConfig`; keep the explicit `model:` literal next to it for eve's AST tooling). Primary `minimax/minimax-m3`; Gateway fallback chain `openai/gpt-5.4-mini` → `google/gemini-2.5-flash` → `google/gemini-2.5-flash-lite` → `openai/gpt-4.1-mini`. Env overrides without a redeploy: `EVE_MODEL`, `EVE_FALLBACK_MODELS` (comma list), `EVE_CONTEXT_TOKENS` (default 200000). `compaction.thresholdPercent 0.8`; session token limits disabled (`limits.maxInput/OutputTokensPerSession: false`). **Do not** set `anthropic/claude-sonnet-4.5` — free-tier AI Gateway returns `MODEL_CALL_FAILED`.
- Channel `agent/channels/eve.ts`: `auth: [vercelOidc(), localDev(), none()]`, `cors: true` so browser guests work.
- Tools under `agent/tools/*.ts` (subagent tool files re-export them). Mutating tools use `mutationApproval()` from `agent/lib/approval.ts`: **`never()` by default** (auto-run), `always()` when `EVE_REQUIRE_APPROVAL=1`. Every call still mints its own `confirmToken` via `POST /api/eve/tools/confirm` (never take one from the model).
- `agent/lib/nest.ts` retries Nest calls twice (1.5 s, 4 s) on network errors, 429 and 5xx (`EVE_NEST_RETRIES` to change).
- `build_lab` takes `spec` (sentence) **or** `lab` (full lab JSON, zod schema in `agent/lib/lab-schema.ts`, ≤ 40 devices / 80 cables). Nest validates with `validateLab`, replays startup lines and returns `startupErrors`, `check` and `summary`, so the builder can fix rejected lines and rebuild. The spec path itself now scales to 12 PCs by adding trunked switches.
- Subagents: explainer / fixer / builder with skills in `agent/skills/`. Builder instructions carry per-kind startup templates, the port table and an addressing plan.
- Evals: `apps/eve-agent/evals/*.eval.ts` (shutdown iface, ROAS, OSPF, wifi nmcli, refuse BGP, build office, build campus JSON).
- Local: `cd apps/eve-agent && npx eve start --host 127.0.0.1 --port 4010` (needs `AI_GATEWAY_API_KEY` in `.env`). `npx eve build` is the compile check (`tsc` is red on pre-existing `.ts`-extension and `sandbox.ts` typing issues).
- Drawer errors: read `data.message` / `data.error` / `code`, not only `data.error`.

Angular drawer (`eve-client.ts`): the context block prepended to every message now carries the whole topology (devices, addresses, gateways, port state), last Check, recent drops and last trace (capped at 40 devices). **Auto-approve** (`nb_eve_auto`, default on; switch in the Eve header) answers `input.requested` tool approvals itself and posts a “Auto-approved …” note; other HITL questions still show Approve/Cancel. **Auto-retry**: a failed turn/session is re-sent up to 2× (1.5 s, 4 s) with “Retrying n/2” notes; after that the error shows a manual Retry (a failed durable session is replaced by a new one). `turn.completed` resets the counters. After tool results, `api.refresh()`.

---

## 9. How to run locally

```bash
cp .env.example .env   # JWT_SECRET, optional DATABASE_URL, AI_GATEWAY_API_KEY
npm install

# three terminals
npm run start -w @netbench/api
# http://127.0.0.1:3001/api/health

cd apps/web && npx ng serve --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.json
# http://127.0.0.1:4200/

cd apps/eve-agent && npx eve start --host 127.0.0.1 --port 4010
```

If API is down, the UI still loads but labs/CLI fail (`ECONNREFUSED 3001`). macOS has **no** `timeout(1)` — use `curl --max-time`.

---

## 10. Tests and verification

```bash
npm test -w @netbench/engine   # 48
npm test -w @netbench/api      # 26
```

`npm run build -w @netbench/engine` (`tsc --noEmit`) is red for reasons that predate the UI work: `.ts` import extensions without `allowImportingTsExtensions`, plus `dport` missing from `PacketEvent` and a `DhcpPool.network` nullability at `engine.ts`. Tests, the API (`tsx`) and the web build do not depend on it.

Live API (after deploy): builtin labs Check true; `labFromSpec` OBJECTIVE sentence; HITL 403 without token / 201 with token; BGP spec 400.

UI changes: **verify in a real browser** at **390×844 and 1280×800**. Exercise the changed path (tap, cable, Add IP, Basic on/off). A single screenshot is not verification.

Vercel production is public GET 200. Some MCP deploys hit SSO — GitHub-linked production URLs still work anonymously.

---

## 11. Deploy

| Service | How |
| --- | --- |
| Angular | Vercel project `netbench-www`, GitHub `main`. Root/workspace build via `apps/web/vercel.json`. |
| API | Railway Docker from **repo root**, `apps/api/Dockerfile`. Do not use a root `railway.json` that maps the Nest image onto the web service (already fixed with per-service Dockerfiles). |
| Eve | `cd apps/eve-agent && npx eve deploy` (OIDC + AI Gateway). |
| DB | Neon; `sql/schema.sql`. |

Push to `main` auto-deploys Vercel www. Railway rebuilds the API when that service is wired to GitHub.

---

## 12. Coding conventions

- TypeScript strict. Angular index signatures: use `rec['message']` not `rec.message` (TS4111).
- Match existing comment style: short, factual. No process narration in comments.
- Do not add BGP/MPLS/VXLAN/802.1X “just for completeness”.
- Prefer `edit` for user topology; Eve mutations go through confirmToken.
- Commit style: `fix(web): …`, `feat(engine): …` — imperative, scoped.
- After UI work, include **https://netbench-www-criscode2022s-projects.vercel.app/** in the user-facing reply if they asked for deploy URLs.

---

## 13. Recent work (mobile / Basic) — do not regress

| Commit | What |
| --- | --- |
| `4d98d9e` | Phone tabbed shell (Canvas/Palette/Inspect/Term/Eve) |
| `80093da` | Oversized SVG + pinch zoom (cables were clipped) |
| `9b78cf5` | Simple IPv4-first UI; auto-place; Cable without picking Gi0/x |
| `9a9eb37` | Basic mobile toggle (default on) |
| `879a738` | Basic sheet Close \| Delete 50/50 |
| `8efa4ed` | Add IP when no IPv4 |
| `a6d4324` | Inspector Close \| Delete |
| `a33a410` | `addLink` no-shuts both ends; list every cable |
| `6d4de07` | Basic cards/sheet show ports without Advanced |
| `1f95015` | Simple vs Advanced split; Ethernet/straight/crossover/fiber; used-port display; occupied-port reject |
| `3d8b0b5` | Help dialogs in Basic; click to toggle ports |
| (uncommitted) | UI overhaul: design tokens + components, Focus mode, session recovery, Reach (ping/trace) with canvas hop replay, hints with one-click fixes, check panel + checklist + Next lab, undo delete/unplug, tidy-up, share links, saved labs + proper sign-in/out, terminal history/completion/quick commands, packets filter + log, keyboard shortcuts, welcome tour |
| (uncommitted) | Learning tools: Troubleshoot assistant (layered reading of engine drop reasons), Watch monitor, checkpoints with config diff/restore, lab editor (name/goal/checks), command palette, subnet/VLAN overlays, packet capture per device, Markdown lab report |
| (uncommitted) | Engine: `ip route del/replace`, `ip addr del/flush`, `no ip route`, `no ip address`, `no ip default-gateway`, AP/WLC `int` + per-port shutdown (fixes the `% Unknown command` lines behind labs 7/8); 9 new labs (17 total) with a curriculum test; UI change-gateway / change-address flows, wrong-mask and NAT diagnoses, expected policy drops shown as “denied” |
| (uncommitted) | Eve: shared model config with a longer cheap fallback chain + env overrides, no session token caps, compaction at 0.8; mutating tools auto-run (`EVE_REQUIRE_APPROVAL=1` restores HITL); Nest calls retried 2×; `build_lab` accepts full lab JSON (`validateLab`, startup-line feedback, immediate check) and the spec builder scales to 12 PCs over trunked switches; drawer auto-approve switch, 2× auto-retry + manual Retry, full-topology context block |

Verified for that work: `ng build` clean; engine 41 / API 26 tests green (untouched); Playwright captures at 1280×800 (desktop, Focus, check pass/fail, ping/trace, troubleshoot, checkpoint diff, monitor turning green, lab editor apply, palette, hints, menu, auth) and 390×844 (Basic, Basic sheet + ping, full-mobile Canvas/Inspect/Terminal).

### Known pitfalls

1. **SVG viewport clipping** — SVG must be world-sized, not `h-full w-full`.
2. **Zoneless Angular** — gesture/pinch native listeners need `cdr.detectChanges()`.
3. **Switch ports admin down** — only Gi0/1–2 are no-shut in lab-1 startup; new cables must `adminUp` (engine `addLink`).
4. **Eve model** — `minimax/minimax-m3` default. Not Sonnet on free Gateway.
5. **Eve URL** — Angular must not use Railway `/eve` for the drawer.
6. **`defineAgent({ name })`** — invalid on eve 0.47.
7. **Tailwind `flex` vs `[class.hidden]`** — use `[ngClass]` to choose `hidden` **or** `flex`, not both.
8. **Guest labs** persist in `localStorage.nb_guest_lab` and restore on reload. Neon SELECT still required for signed-in lab lists.
9. **Builder spec** — bare “PC” must count; VLAN per role; emit ping Check.
10. **Header stacking** — the header has `backdrop-blur` (a stacking context); it must keep `relative z-30` or its popovers (lab picker, ⋯ menu) render under the canvas.
11. **No regex literals / arrow functions in templates** — Angular rejects them; use component methods (`isApproveOption`, `reachHasTarget`).
12. **Terminal input** binds `[value]`/`(input)` to a signal on purpose: `ngModel` writes programmatic changes asynchronously, which breaks Tab completion and ↑/↓ history.
13. **Hints are state, not simulation** — `hintsFor()` only reads engine facts (adminUp, status, peers, running-config, checks). Never add a hint that predicts forwarding.

---

## 14. Suggested next work (not started)

These are ideas, not commitments:

- Recable/no-shut existing Gi0/3 on old sessions without asking the user to delete the cable.
- Persist Basic/Advanced/Focus per user account, not only localStorage.
- Dedicated `POST /sessions/:id/state` (or `/labs` on builtin id) that does not let a signed-in autosave overwrite a row keyed by a builtin lab id.
- Railway API auto-deploy confirmation after engine-only commits (`addLink` / cable types live in the engine image).
- Desktop Basic is unused; only phones. Desktop uses Simple vs Advanced.
- Console cable (out-of-band CLI) — not in the palette.

---

## 15. Quick “where do I edit X?”

| Want | Edit |
| --- | --- |
| Ping/ARP/OSPF/VLAN forwarding | `packages/engine/src/engine.ts` |
| Builtin labs | `packages/engine/src/labs.ts` |
| New device kind (discouraged) | `types.ts` KIND_PORTS + `devices.ts` + UI palette |
| Builder English → topology | `packages/engine/src/build.ts` |
| REST/WS | `apps/api/src/http.ts`, `create-app.ts`, `sim.service.ts` |
| Canvas / Basic / inspector / Focus | `apps/web/src/app/workspace.ts` + `workspace.html` |
| Terminal behaviour, quick commands | `apps/web/src/app/terminal.ts` |
| Packet list / activity log | `apps/web/src/app/packets.ts` |
| Icons, colours, button styles | `apps/web/src/app/icons.ts`, `apps/web/src/styles.css` |
| API origin / palette labels | `apps/web/src/app/api.ts` |
| Eve stream / HITL | `apps/web/src/app/eve-client.ts` |
| Eve model / tools | `apps/eve-agent/agent/agent.ts`, `agent/tools/` |
| DB schema | `sql/schema.sql` + `apps/api/src/store.ts` |

---

## 16. First commands for a new agent

```bash
cd /Users/cristian/orca/network-lab   # or the worktree you were given
git status && git log -5 --oneline
npm test -w @netbench/engine && npm test -w @netbench/api
```

Then read `workspace.html` / `workspace.ts` if the task is UI, or `engine.ts` / `labs.ts` if it is forwarding. Keep the eight-device junior palette. Verify phones at 390×844 and desktop at 1280×800 for any UI change.
