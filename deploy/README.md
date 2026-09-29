# Debian SSTP deployment

The web application may remain behind Cloudflare Tunnel. SSTP must use a separate DNS-only hostname that points directly to the public IP and forwards TCP 443 to Debian.

1. Install a maintained accel-ppp package or build from its official source with SSTP and OpenSSL enabled.
2. Obtain a valid TLS certificate for the VPN hostname.
3. Copy `accel-ppp.conf.example` to the accel-ppp configuration location and replace the hostname and certificate paths.
4. Create `/var/lib/mikrotik-ai`, owned by the account that runs MikroTik AI, with mode `0700`.
5. Set the `SSTP_*` variables from `.env.example`. The pool and server IP must match the accel-ppp configuration.
6. Permit inbound TCP 443 to accel-ppp. Do not expose RouterOS API port 8728 on the public interface.
7. Restart accel-ppp and MikroTik AI, then confirm `/api/status` reports `sstpReady: true`.

The application rewrites only the configured `SSTP_CHAP_SECRETS_PATH` using an atomic rename. Do not point that variable at a secrets file managed by another service. Keep the file readable only by the application account and root/accel-ppp.

Deleting an SSTP account in the dashboard removes it from `chap-secrets`, so it cannot reconnect. If that router still has an active session, terminate the session through accel-ppp as part of the server operation procedure.
