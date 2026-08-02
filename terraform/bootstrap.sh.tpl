#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ── SSH ──────────────────────────────────────────────────────────────────────
mkdir -p /root/.ssh
chmod 700 /root/.ssh
echo "${ssh_authorized_key}" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# ── Paquets ──────────────────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 wget curl rsync

# ── Cloudflared ──────────────────────────────────────────────────────────────
wget -qO /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i /tmp/cloudflared.deb || apt-get install -f -y -qq

mkdir -p /etc/cloudflared
cat > /etc/cloudflared/credentials.json <<'CREDS'
{
  "AccountTag": "${account_tag}",
  "TunnelID": "${tunnel_id}",
  "TunnelSecret": "${tunnel_secret}"
}
CREDS
chmod 600 /etc/cloudflared/credentials.json

cat > /usr/local/bin/run-cloudflared.sh <<'SCRIPT'
#!/bin/bash
exec /usr/bin/cloudflared --no-autoupdate tunnel run --credentials-file /etc/cloudflared/credentials.json ${tunnel_id}
SCRIPT
chmod +x /usr/local/bin/run-cloudflared.sh

cat > /etc/systemd/system/cloudflared.service <<'UNIT'
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/run-cloudflared.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# ── TREK app ─────────────────────────────────────────────────────────────────
mkdir -p /opt/trek /var/lib/trek/data /var/lib/trek/uploads

cat > /opt/trek/.env <<'ENV'
%{ for key, value in trek_env ~}
${key}=${value}
%{ endfor ~}
ENV
chmod 600 /opt/trek/.env

cat > /opt/trek/docker-compose.yml <<'COMPOSE'
services:
  app:
    image: ${trek_image}
    container_name: trek
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    tmpfs:
      - /tmp:noexec,nosuid,size=128m
    ports:
      - "127.0.0.1:3000:3000"
    env_file:
      - /opt/trek/.env
    volumes:
      - /var/lib/trek/data:/app/data
      - /var/lib/trek/uploads:/app/uploads
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
COMPOSE

# ── Migration données ────────────────────────────────────────────────────────
%{ if enable_data_migration ~}
if [ -z "$(ls -A /var/lib/trek/data 2>/dev/null)" ]; then
  for pair in "${migrate_data_device}:/mnt/migrate-data:/var/lib/trek/data" "${migrate_uploads_device}:/mnt/migrate-uploads:/var/lib/trek/uploads"; do
    IFS=: read -r dev mnt tgt <<< "$pair"
    for _ in $(seq 1 30); do [ -b "$dev" ] && break; sleep 2; done
    if [ -b "$dev" ]; then
      mkdir -p "$mnt"
      mount -o ro "$dev" "$mnt" 2>/dev/null || true
      if [ "$(ls -A "$mnt" 2>/dev/null | wc -l)" -gt 0 ]; then
        echo "Migrating $dev -> $tgt"
        rsync -a "$mnt"/ "$tgt"/
      fi
      umount "$mnt" 2>/dev/null || true
    fi
  done
fi
%{ endif ~}

# ── Démarrage ────────────────────────────────────────────────────────────────
systemctl enable docker
systemctl start docker

cd /opt/trek
docker compose pull
docker compose up -d

systemctl daemon-reload
systemctl enable cloudflared.service
systemctl start cloudflared.service

echo "Bootstrap finished."
