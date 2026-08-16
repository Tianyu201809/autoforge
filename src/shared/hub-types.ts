export type HubScope = 'marketplace' | 'personal' | 'team'
export type HubSort = 'newest' | 'oldest' | 'name' | 'installs' | 'updated'

export interface HubUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string
  teamCount: number
}

export interface HubSession {
  authenticated: boolean
  persistent: boolean
  user: HubUser | null
}

export interface HubTeam {
  id: string
  name: string
  description: string
  ownerId: string
  memberCount: number
  icon: string
  iconColor?: string
  avatarUrl: string
}

export interface HubPlugin {
  id: string
  title: string
  description: string
  readme?: string
  category: string
  language: string
  tags: string[]
  icon: string
  iconColor?: string
  ownerId: string
  ownerDisplayName: string
  ownerAvatarUrl: string
  teamId?: string
  createdAt: string
  updatedAt: string
  visibility: 'private' | 'public'
  publishedAt?: string
  installCount: number
}

export interface HubPluginQuery {
  scope: HubScope
  teamId?: string
  page: number
  pageSize: number
  q?: string
  category?: string
  language?: string
  sort?: HubSort
}

export interface HubPluginListResult {
  items: HubPlugin[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  distributions: { category: Record<string, number>; language: Record<string, number> }
}

export type HubErrorCode =
  | 'hub_not_configured'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'quota_exceeded'
  | 'busy'
  | 'install_failed'
  | 'invalid_response'

export class HubClientError extends Error {
  constructor(public readonly code: HubErrorCode, message: string, public readonly status?: number) {
    super(message)
    this.name = 'HubClientError'
  }
}
