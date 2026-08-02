provider "scaleway" {
  region     = var.region
  zone       = var.zone
  project_id = var.project_id
}

# Authentification Cloudflare : CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL
provider "cloudflare" {
  api_key = var.cloudflare_api_key
  email   = var.cloudflare_email
}
