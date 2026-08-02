variable "project_id" {
  description = "ID du projet Scaleway (SCW_DEFAULT_PROJECT_ID)"
  type        = string
  default     = "6eaccdad-8a37-46c2-b1b2-623d24e9e32e"
}

variable "region" {
  description = "Région Scaleway"
  type        = string
  default     = "fr-par"
}

variable "zone" {
  description = "Zone Scaleway"
  type        = string
  default     = "fr-par-1"
}

variable "instance_type" {
  description = "Type d'instance Scaleway"
  type        = string
  default     = "DEV1-S"
}

variable "trek_image" {
  description = "Image Docker TREK à déployer"
  type        = string
  default     = "mauriceboe/trek:latest"
}

variable "root_volume_size_gb" {
  description = "Taille du disque local (l_ssd) — données + uploads inclus"
  type        = number
  default     = 30
}

variable "domain_name" {
  description = "Nom de domaine public (ex. trek.mages.pro)"
  type        = string
  default     = ""
}

variable "enable_cloudflare" {
  description = "Activer la gestion DNS Cloudflare"
  type        = bool
  default     = false
}

variable "enable_cloudflare_tunnel" {
  description = "Exposer TREK via Cloudflare Tunnel (0 €, pas de LB ni IPv4)"
  type        = bool
  default     = true
}

variable "cloudflare_account_id" {
  description = "ID du compte Cloudflare (Zero Trust Tunnel)"
  type        = string
  default     = ""
}

variable "cloudflare_zone_name" {
  description = "Zone Cloudflare (ex. mages.pro)"
  type        = string
  default     = ""
}

variable "cloudflare_api_key" {
  description = "Clé API globale Cloudflare"
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_email" {
  description = "Email du compte Cloudflare"
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_ssh" {
  description = "Ouvrir le port 22 pour SSH"
  type        = bool
  default     = false
}

variable "enable_ipv4" {
  description = "Attacher une IPv4 flexible (payante, pour diagnostic SSH)"
  type        = bool
  default     = false
}

variable "ssh_authorized_key" {
  description = "Clé publique SSH pour accès root"
  type        = string
  default     = ""
}

variable "enable_data_migration" {
  description = "Restaurer les données depuis les snapshots block storage"
  type        = bool
  default     = false
}

variable "migrate_data_snapshot_id" {
  description = "ID snapshot données (zone/uuid)"
  type        = string
  default     = ""
}

variable "migrate_uploads_snapshot_id" {
  description = "ID snapshot uploads (zone/uuid)"
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Origines CORS autorisées"
  type        = string
  default     = ""
}

variable "app_url" {
  description = "URL publique de l'application"
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "Email du compte admin initial"
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_password" {
  description = "Mot de passe admin initial"
  type        = string
  default     = ""
  sensitive   = true
}

variable "encryption_key" {
  description = "Clé de chiffrement at-rest — conserver la même pour préserver les données"
  type        = string
  default     = ""
  sensitive   = true
}

variable "timezone" {
  description = "Fuseau horaire"
  type        = string
  default     = "Europe/Paris"
}

variable "force_https" {
  description = "Forcer HTTPS (derrière Cloudflare Tunnel)"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags Scaleway"
  type        = list(string)
  default     = ["trek", "terraform"]
}
