import jwt from 'jsonwebtoken'

const TOKEN_EXPIRES_IN = '7d'

export interface JwtPayload {
  sub: string
  username: string
}

/**
 * JWT 서명에 사용할 시크릿을 반환합니다.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret) {
    throw new Error('JWT_SECRET 환경변수가 없습니다. .env.local을 확인하세요.')
  }
  return secret
}

/**
 * JWT 액세스 토큰을 발급합니다.
 */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRES_IN })
}

/**
 * JWT 토큰을 검증하고 페이로드를 반환합니다.
 */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload
}
