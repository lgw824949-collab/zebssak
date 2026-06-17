import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of envText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnv()

const ref = 'hlibpopmwxxdaxaxnnrz'
const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim()
const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '014_match_requests_presence_mode.sql'),
  'utf8'
)

const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim()
const poolerHost = 'aws-1-ap-northeast-2.pooler.supabase.com'

const candidates = [
  process.env.DATABASE_URL,
  process.env.SUPABASE_DB_URL,
  dbPassword &&
    `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@${poolerHost}:6543/postgres`,
  dbPassword &&
    `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@${poolerHost}:5432/postgres`,
].filter(Boolean)

async function main() {
  for (const url of candidates) {
    const label = url.slice(0, 40) + '...'
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    try {
      await client.connect()
      await client.query(sql)
      const check = await client.query(
        `SELECT column_name, data_type, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'match_requests'
           AND column_name = 'presence_mode'`
      )
      console.log('OK via', label)
      console.log(check.rows)
      await client.end()
      process.exit(0)
    } catch (err) {
      console.error('FAIL', label, err.message)
      try {
        await client.end()
      } catch {
        // ignore
      }
    }
  }
  process.exit(1)
}

main()
