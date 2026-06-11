/**
 * 테스트 계정 일괄 삭제 (어드민 API 호출)
 */
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

const base = process.env.TEST_BASE_URL || 'http://localhost:3000'
const adminKey = process.env.ADMIN_SECRET?.trim() || ''

const response = await fetch(`${base}/api/admin/users/delete-test`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-key': adminKey,
  },
})

const body = await response.json()
process.stdout.write(`status: ${response.status}\n`)
process.stdout.write(`${JSON.stringify(body, null, 2)}\n`)

if (!response.ok || body.success !== true) {
  process.exit(1)
}
