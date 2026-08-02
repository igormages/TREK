output "trek_url" {
  description = "URL d'accès à TREK"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : (
    var.enable_ipv4 ? "http://${scaleway_instance_ip.trek_ipv4[0].address}:3000" : "http://[${scaleway_instance_ip.trek_ipv6[0].address}]"
  )
}

output "instance_ipv6" {
  description = "IPv6 publique de l'instance (gratuite)"
  value       = var.enable_ipv4 ? null : scaleway_instance_ip.trek_ipv6[0].address
}

output "instance_ipv4" {
  description = "IPv4 publique (temporaire si enable_ipv4)"
  value       = var.enable_ipv4 ? scaleway_instance_ip.trek_ipv4[0].address : null
}

output "ssh_hint" {
  description = "Commande SSH"
  value       = var.enable_ipv4 ? "ssh root@${scaleway_instance_ip.trek_ipv4[0].address}" : "ssh root@[${scaleway_instance_ip.trek_ipv6[0].address}]"
}

output "cloudflare_tunnel_id" {
  description = "ID du Cloudflare Tunnel"
  value       = var.enable_cloudflare_tunnel ? cloudflare_zero_trust_tunnel_cloudflared.trek[0].id : null
}

output "cloudflare_dns_record" {
  description = "Enregistrement DNS Cloudflare"
  value = var.enable_cloudflare_tunnel ? {
    name    = cloudflare_dns_record.trek[0].name
    type    = cloudflare_dns_record.trek[0].type
    content = cloudflare_dns_record.trek[0].content
    proxied = cloudflare_dns_record.trek[0].proxied
  } : null
}

output "instance_id" {
  description = "ID de l'instance Scaleway"
  value       = scaleway_instance_server.trek.id
}

output "encryption_key" {
  description = "Clé de chiffrement (à sauvegarder en lieu sûr)"
  value       = var.encryption_key != "" ? var.encryption_key : random_id.encryption_key.hex
  sensitive   = true
}
