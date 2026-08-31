# Wi-Fi (simplified BSS)

SSID + open/WPA2-PSK, one SSID → one VLAN, AP uplink into the switch.
Associate then DHCP: `nmcli wifi connect SSID password PSK`.
Channel is cosmetic except same-SSID/same-channel = one BSS.
WLC is capwap-lite with local-breakout datapath. No 802.1X, no guest portal.
If the client is not associated, wired pings will not start — tell them the nmcli line.
