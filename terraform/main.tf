locals {
  name = "trek"

  public_app_url = var.app_url != "" ? var.app_url : (
    var.domain_name != "" ? "https://${var.domain_name}" : ""
  )

  public_allowed_origins = var.allowed_origins != "" ? var.allowed_origins : local.public_app_url

  behind_proxy = var.enable_cloudflare_tunnel || var.enable_cloudflare

  trek_env = {
    NODE_ENV        = "production"
    PORT            = "3000"
    TZ              = var.timezone
    LOG_LEVEL       = "info"
    TRUST_PROXY     = local.behind_proxy ? "1" : "0"
    FORCE_HTTPS     = local.behind_proxy && var.force_https ? "true" : "false"
    ALLOWED_ORIGINS = local.public_allowed_origins
    APP_URL         = local.public_app_url
    ADMIN_EMAIL     = var.admin_email
    ADMIN_PASSWORD  = var.admin_password
    ENCRYPTION_KEY  = var.encryption_key != "" ? var.encryption_key : random_id.encryption_key.hex
  }

  migration_volumes = var.enable_data_migration ? [
    scaleway_block_volume.migrate_data[0].id,
    scaleway_block_volume.migrate_uploads[0].id,
  ] : []
}

resource "random_id" "encryption_key" {
  byte_length = 32
}

# ── Sécurité (aucun port entrant — accès via Cloudflare Tunnel) ───────────────

resource "scaleway_instance_security_group" "trek" {
  name                    = "${local.name}-sg"
  inbound_default_policy  = "drop"
  outbound_default_policy = "accept"
  tags                    = var.tags

  dynamic "inbound_rule" {
    for_each = var.enable_ssh ? [1] : []
    content {
      action   = "accept"
      protocol = "TCP"
      port     = 22
    }
  }
}

# ── Instance (IPv6 gratuite, stockage local, pas d'IPv4) ────────────────────

# IPv4 temporaire pour diagnostic / SSH (désactiver après migration)
resource "scaleway_instance_ip" "trek_ipv4" {
  count = var.enable_ipv4 ? 1 : 0
  tags  = var.tags
}

resource "scaleway_instance_ip" "trek_ipv6" {
  count = var.enable_ipv4 ? 0 : 1
  type  = "routed_ipv6"
  tags  = var.tags
}

resource "scaleway_instance_server" "trek" {
  name              = "${local.name}-app"
  type              = var.instance_type
  image             = "ubuntu_jammy"
  enable_dynamic_ip = false
  ip_id             = var.enable_ipv4 ? scaleway_instance_ip.trek_ipv4[0].id : scaleway_instance_ip.trek_ipv6[0].id
  tags              = var.tags

  security_group_id = scaleway_instance_security_group.trek.id

  additional_volume_ids = local.migration_volumes

  root_volume {
    size_in_gb            = var.root_volume_size_gb
    volume_type           = "l_ssd"
    delete_on_termination = true
  }

  user_data = {
    cloud-init = templatefile("${path.module}/cloud-init.yml.tpl", {
      bootstrap_script = indent(0, templatefile("${path.module}/bootstrap.sh.tpl", {
        trek_image               = var.trek_image
        trek_env                 = local.trek_env
        enable_data_migration    = var.enable_data_migration
        migrate_data_device      = var.enable_data_migration ? "/dev/sdb" : ""
        migrate_uploads_device   = var.enable_data_migration ? "/dev/sdc" : ""
        account_tag              = var.cloudflare_account_id
        tunnel_id                = var.enable_cloudflare_tunnel ? cloudflare_zero_trust_tunnel_cloudflared.trek[0].id : ""
        tunnel_secret            = var.enable_cloudflare_tunnel ? random_id.tunnel_secret[0].b64_std : ""
        ssh_authorized_key       = var.ssh_authorized_key
      }))
    })
  }

  depends_on = [
    cloudflare_zero_trust_tunnel_cloudflared.trek,
  ]
}
