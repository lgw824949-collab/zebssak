import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { isTestUsername } from '@/app/api/admin/user-categories'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const USER_PAGE_SIZE = 500
const REQUEST_ID_CHUNK = 50
const DELETE_USER_CHUNK = 20

interface DeleteTestUsersResult {
  deleted: number
  failed: number
  skipped: number
  errors: string[]
}

/**
 * 테스트 계정 ID 전체 조회
 */
async function fetchAllTestUserIds(
  supabase: SupabaseClient
): Promise<string[]> {
  const ids: string[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('id, username')
      .order('created_at', { ascending: false })
      .range(from, from + USER_PAGE_SIZE - 1)

    if (error) {
      throw new Error('테스트 계정 목록을 조회할 수 없습니다.')
    }

    if (!data?.length) {
      break
    }

    for (const row of data) {
      if (typeof row.username === 'string' && isTestUsername(row.username)) {
        ids.push(String(row.id))
      }
    }

    if (data.length < USER_PAGE_SIZE) {
      break
    }

    from += USER_PAGE_SIZE
  }

  return ids
}

/**
 * 테스트 유저 매칭 요청에 연결된 matches 선삭제 (FK 제약)
 */
async function deleteMatchesForUsers(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  const requestIds: string[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('match_requests')
      .select('id')
      .in('user_id', userIds)
      .range(from, from + USER_PAGE_SIZE - 1)

    if (error) {
      throw new Error('매칭 요청을 조회할 수 없습니다.')
    }

    if (!data?.length) {
      break
    }

    for (const row of data) {
      requestIds.push(String(row.id))
    }

    if (data.length < USER_PAGE_SIZE) {
      break
    }

    from += USER_PAGE_SIZE
  }

  for (let i = 0; i < requestIds.length; i += REQUEST_ID_CHUNK) {
    const chunk = requestIds.slice(i, i + REQUEST_ID_CHUNK)
    const { error: seekError } = await supabase
      .from('matches')
      .delete()
      .in('seat_seek_request_id', chunk)

    if (seekError) {
      throw new Error('매칭 기록 삭제에 실패했습니다.')
    }

    const { error: leaveError } = await supabase
      .from('matches')
      .delete()
      .in('leaving_request_id', chunk)

    if (leaveError) {
      throw new Error('매칭 기록 삭제에 실패했습니다.')
    }
  }
}

/**
 * public.users 직접 삭제 (auth.users 없는 고아 계정)
 */
async function deletePublicUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('users').delete().eq('id', userId)
  if (error) {
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

/**
 * auth.users 삭제 — 실패 시 public.users 고아 행 직접 삭제
 */
async function deleteTestUserRows(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<DeleteTestUsersResult> {
  const result: DeleteTestUsersResult = {
    deleted: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }

  for (let i = 0; i < userIds.length; i += DELETE_USER_CHUNK) {
    const chunk = userIds.slice(i, i + DELETE_USER_CHUNK)

    await Promise.all(
      chunk.map(async (userId) => {
        const { error } = await supabase.auth.admin.deleteUser(userId)
        if (!error) {
          result.deleted += 1
          return
        }

        const authMissing =
          error.message.toLowerCase().includes('not found') ||
          error.message.toLowerCase().includes('user not found')

        if (authMissing) {
          const fallback = await deletePublicUser(supabase, userId)
          if (fallback.ok) {
            result.deleted += 1
            return
          }
          result.failed += 1
          if (result.errors.length < 5) {
            result.errors.push(`${userId}: ${fallback.message ?? error.message}`)
          }
          return
        }

        result.failed += 1
        if (result.errors.length < 5) {
          result.errors.push(`${userId}: ${error.message}`)
        }
      })
    )
  }

  return result
}

/**
 * POST /api/admin/users/delete-test — 테스트 계정 일괄 삭제
 */
export async function POST(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const supabase = createSupabaseAdminClient()
    const testUserIds = await fetchAllTestUserIds(supabase)

    if (testUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { deleted: 0, failed: 0, skipped: 0, errors: [] },
      })
    }

    await deleteMatchesForUsers(supabase, testUserIds)
    const result = await deleteTestUserRows(supabase, testUserIds)

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        targeted: testUserIds.length,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '서버 오류가 발생했습니다.'
    return adminErrorResponse(message, 500)
  }
}
