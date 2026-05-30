import bcrypt from 'bcryptjs'
import type { SupabaseClient } from '@supabase/supabase-js'

const SALT_ROUNDS = 10

/**
 * bcrypt 해시 형식인지 확인합니다.
 */
export function isBcryptHash(passwordHash: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(passwordHash)
}

/**
 * 비밀번호를 bcrypt로 해시합니다.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * 비밀번호와 해시를 비교합니다.
 */
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  if (!passwordHash) {
    return false
  }
  if (isBcryptHash(passwordHash)) {
    return bcrypt.compare(password, passwordHash)
  }
  // 마이그레이션 전 평문 저장 계정 호환
  return password === passwordHash
}

/**
 * 평문 비밀번호 저장 계정을 bcrypt로 갱신합니다.
 */
export async function upgradePlainPasswordHash(
  supabase: SupabaseClient,
  userId: string,
  password: string,
  currentHash: string
): Promise<void> {
  if (isBcryptHash(currentHash)) {
    return
  }
  const passwordHash = await hashPassword(password)
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', userId)
  if (error) {
    throw new Error(error.message)
  }
}
