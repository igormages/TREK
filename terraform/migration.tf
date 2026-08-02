# Volumes temporaires créés depuis les snapshots (sauvegarde avant refonte).
# Supprimables après migration réussie (enable_data_migration = false).

resource "scaleway_block_volume" "migrate_data" {
  count = var.enable_data_migration ? 1 : 0

  name        = "${local.name}-migrate-data"
  snapshot_id = var.migrate_data_snapshot_id
  iops        = 5000
  zone        = var.zone
  tags        = var.tags
}

resource "scaleway_block_volume" "migrate_uploads" {
  count = var.enable_data_migration ? 1 : 0

  name        = "${local.name}-migrate-uploads"
  snapshot_id = var.migrate_uploads_snapshot_id
  iops        = 5000
  zone        = var.zone
  tags        = var.tags
}
