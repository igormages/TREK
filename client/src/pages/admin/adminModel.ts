/** Shared types for the admin page + its data hook. No React, no side effects. */

export interface AdminUser {
  id: number
  username: string
  email: string
  role: 'admin' | 'user'
  created_at: string
  last_login?: string | null
  online?: boolean
  oidc_issuer?: string | null
  avatar_url?: string | null
  /** YYYY-MM-DD or null. Lets an accommodation search count adults, not heads. */
  birth_date?: string | null
}

export interface AdminStats {
  totalUsers: number
  totalTrips: number
  totalPlaces: number
  totalFiles: number
}

export interface OidcConfig {
  issuer: string
  client_id: string
  client_secret: string
  client_secret_set: boolean
  display_name: string
  discovery_url: string
}

/**
 * Travelpayouts credentials behind the accommodation map's price pills.
 * `token` is what the operator just typed; `token_set` is all the server ever
 * discloses about the stored one.
 */
export interface TravelpayoutsConfig {
  token: string
  token_set: boolean
  /** An env var overrides the stored token — worth saying, or a saved key looks ignored. */
  token_from_env: boolean
  marker: string
}

export interface UpdateInfo {
  update_available: boolean
  latest: string
  current: string
  release_url?: string
  is_docker?: boolean
  is_prerelease?: boolean
}
