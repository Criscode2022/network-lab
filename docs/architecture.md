# NetBench architecture

The discrete-event engine (`packages/engine`) is pure TypeScript. Nest (`apps/api`) holds one `Engine` per open lab session and exposes REST + WebSocket. Angular never guesses forwarding: ping, traceroute, Check, and Eve tools call the same `getPath` / `check` / `exec` methods.

## Frame / packet / wifi / OSPF

- **L2:** MAC learning, access vs 802.1Q trunk, RSTP-lite blocks a port if the VLAN graph has a cycle.
- **L3:** ARP, NDP, connected + static + OSPFv2 area 0, ICMP/ICMPv6 echo and TTL/hop-limit expiry.
- **Services:** DHCPv4, SLAAC+RA RDNSS, DNS A/AAAA, SSH as TCP/22 + login shell (simulated), stateful firewall, IPv4 SNAT.
- **Wi-Fi:** simplified BSS (SSID, PSK, channel cosmetic except same-SSID/same-channel). After association a dashed radio link carries IP like Ethernet. WLC is capwap-lite, local-breakout datapath.
- **Cables:** `ethernet` (auto-MDIX) always gets carrier. `straight` / `crossover` follow CCNA like/unlike rules (switch is the intermediary). Wrong type stays plugged but `operUp` is false with status `Wrong cable`. `fiber` needs SFP-capable devices (not PC/server/cloud). A port accepts only one cable.

Approximations (SSH crypto, RF, OSPF P2P) carry a **simulated** badge. Success is never faked: drops keep an honest reason string shared with the packet inspector and Eve `get_path`.

## Eve

`apps/eve-agent` is a Vercel eve project. Tools HTTP POST to Nest `/api/eve/tools/*`. Mutating tools use `approval: always()` plus Nest `confirmToken`. Eve **reads the engine** (lab state, path, check) instead of inventing topology.

## Deploy split

| Piece | Host | Why |
| --- | --- | --- |
| Angular | Vercel | static |
| Eve | Vercel (`eve deploy`) | AI Gateway OIDC |
| Nest + engine | Railway / Fly / Render (long-running Node) | forwarding is not a 10s serverless function |
| Postgres | Neon | users + saved labs |
