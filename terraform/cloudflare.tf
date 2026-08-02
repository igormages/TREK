locals {
  dns_subdomain = var.domain_name != "" && var.cloudflare_zone_name != "" ? replace(
    var.domain_name,
    ".${var.cloudflare_zone_name}",
    ""
  ) : ""
}

data "cloudflare_zone" "main" {
  count = var.enable_cloudflare ? 1 : 0

  filter = {
    name = var.cloudflare_zone_name
  }
}

resource "random_id" "tunnel_secret" {
  count = var.enable_cloudflare_tunnel ? 1 : 0

  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "trek" {
  count = var.enable_cloudflare_tunnel ? 1 : 0

  account_id    = var.cloudflare_account_id
  name          = "trek-tunnel"
  config_src    = "cloudflare"
  tunnel_secret = random_id.tunnel_secret[0].b64_std
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "trek" {
  count = var.enable_cloudflare_tunnel ? 1 : 0

  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.trek[0].id

  config = {
    ingress = [
      {
        hostname = var.domain_name
        service  = "http://localhost:3000"
      },
      {
        service = "http_status:404"
      },
    ]
  }
}

resource "cloudflare_dns_record" "trek" {
  count = var.enable_cloudflare_tunnel ? 1 : 0

  zone_id = data.cloudflare_zone.main[0].id
  name    = local.dns_subdomain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.trek[0].id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "TREK — Cloudflare Tunnel (Terraform)"
}
