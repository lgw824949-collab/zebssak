import fs from 'fs'
import path from 'path'
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

const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
  /https:\/\/([^.]+)\.supabase\.co/
)?.[1]

if (!projectRef) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL')
  process.exit(1)
}

const migrationPath = process.argv[2]
if (!migrationPath) {
  console.error('Usage: node apply-sql-migration.mjs <migration.sql>')
  process.exit(1)
}

const sql = fs.readFileSync(migrationPath, 'utf8')
const secretKey = process.env.SUPABASE_SECRET_KEY

async function tryManagementApi() {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function tryPgMeta() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function verifyTable() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/timetable?select=id&limit=1`,
    {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
      },
    }
  )
  return { ok: res.ok, status: res.status, text: await res.text() }
}

async function main() {
  console.log('Applying migration:', migrationPath)

  for (const [name, fn] of [
    ['management-api', tryManagementApi],
    ['pg-meta', tryPgMeta],
  ]) {
    try {
      const result = await fn()
      console.log(name, result.status, result.text.slice(0, 500))
      if (result.ok) {
        const verify = await verifyTable()
        console.log('verify timetable', verify.status, verify.text.slice(0, 200))
        if (verify.ok || verify.status === 200) {
          console.log('OK')
          process.exit(0)
        }
      }
    } catch (err) {
      console.error(name, err.message)
    }
  }

  console.error('Failed to apply migration via API')
  process.exit(1)
}

main()
