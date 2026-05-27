import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

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
  return bcrypt.compare(password, passwordHash)
}
