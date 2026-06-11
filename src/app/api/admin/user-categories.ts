/** 신규 가입 기준 (일) */
export const NEW_USER_DAYS = 7

/** E2E·스크립트 자동 가입 계정 접두사 */
const TEST_USERNAME_PATTERN =
  /^(ft|td|lt|pair|skq|skp|lvq|lvp|seeker|provider|w|s)\d{5,}$/i

/**
 * 테스트·E2E 자동 계정 여부
 */
export function isTestUsername(username: string): boolean {
  return TEST_USERNAME_PATTERN.test(username)
}

export type AdminUserCategory =
  | 'new'
  | 'test'
  | 'vulnerable'
  | 'suspended'
  | 'warning'
  | 'risk'

export type AdminUserCategoryFilter =
  | 'all'
  | 'real'
  | 'new'
  | 'test'
  | 'vulnerable'
  | 'suspended'
  | 'warning'
  | 'risk'

export interface AdminUserRow {
  username: string
  is_vulnerable: boolean
  no_show_count: number
  suspended_until: string | null
  created_at: string
}

export interface AdminUserWithCategories extends AdminUserRow {
  categories: AdminUserCategory[]
}

/**
 * 어드민 유저 분류 — 복수 뱃지 가능
 */
export function classifyAdminUser(user: AdminUserRow): AdminUserCategory[] {
  const categories: AdminUserCategory[] = []
  const now = Date.now()

  if (isTestUsername(user.username)) {
    categories.push('test')
  }

  const createdAt = new Date(user.created_at).getTime()
  if (
    !Number.isNaN(createdAt) &&
    now - createdAt <= NEW_USER_DAYS * 24 * 60 * 60 * 1000
  ) {
    categories.push('new')
  }

  if (user.is_vulnerable) {
    categories.push('vulnerable')
  }

  if (
    user.suspended_until != null &&
    new Date(user.suspended_until).getTime() > now
  ) {
    categories.push('suspended')
  }

  if (user.no_show_count >= 3) {
    categories.push('risk')
  } else if (user.no_show_count >= 1) {
    categories.push('warning')
  }

  return categories
}

export function parseUserCategoryFilter(
  value: string | null
): AdminUserCategoryFilter {
  const allowed: AdminUserCategoryFilter[] = [
    'all',
    'real',
    'new',
    'test',
    'vulnerable',
    'suspended',
    'warning',
    'risk',
  ]
  if (value && allowed.includes(value as AdminUserCategoryFilter)) {
    return value as AdminUserCategoryFilter
  }
  return 'real'
}

/**
 * 분류 필터 적용
 */
export function filterUsersByCategory<T extends { categories: AdminUserCategory[] }>(
  users: T[],
  filter: AdminUserCategoryFilter
): T[] {
  if (filter === 'all') {
    return users
  }
  if (filter === 'real') {
    return users.filter((user) => !user.categories.includes('test'))
  }
  return users.filter((user) => user.categories.includes(filter))
}

/**
 * 분류별 인원 집계
 */
export function countUsersByCategory(
  users: Array<{ categories: AdminUserCategory[] }>
): Record<AdminUserCategory | 'real', number> {
  const counts: Record<AdminUserCategory | 'real', number> = {
    new: 0,
    test: 0,
    vulnerable: 0,
    suspended: 0,
    warning: 0,
    risk: 0,
    real: 0,
  }

  for (const user of users) {
    for (const category of user.categories) {
      counts[category] += 1
    }
    if (!user.categories.includes('test')) {
      counts.real += 1
    }
  }

  return counts
}
