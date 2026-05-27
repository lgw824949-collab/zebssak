import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env.local')
const envText = fs.readFileSync(envPath, 'utf8')

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Supabase env missing')
  process.exit(1)
}

const supabase = createClient(url, key)

const EXTENSION_STATIONS = [
  { station_code: 'l1-29', station_name: '아라', line_number: 1, station_order: 2 },
  { station_code: 'l1-30', station_name: '신검단중앙', line_number: 1, station_order: 3 },
  { station_code: 'l1-31', station_name: '검단호수공원', line_number: 1, station_order: 4 },
]

async function main() {
  const { data: existing, error: listError } = await supabase
    .from('stations')
    .select('station_code, station_name, station_order')
    .eq('line_number', 1)
    .order('station_order')

  if (listError) {
    console.error('list failed:', listError.message)
    process.exit(1)
  }

  const hasExtension = EXTENSION_STATIONS.every((row) =>
    existing?.some((s) => s.station_code === row.station_code)
  )

  if (!hasExtension) {
    const toShift = (existing ?? []).filter(
      (row) =>
        row.station_code >= 'l1-02' &&
        row.station_code <= 'l1-28' &&
        row.station_order >= 2 &&
        row.station_order <= 28
    )

    for (const row of toShift) {
      const { error } = await supabase
        .from('stations')
        .update({ station_order: row.station_order + 3 })
        .eq('station_code', row.station_code)

      if (error) {
        console.error('shift failed:', row.station_code, error.message)
        process.exit(1)
      }
    }
  }

  for (const row of EXTENSION_STATIONS) {
    const { error } = await supabase.from('stations').upsert(row, {
      onConflict: 'station_code',
    })

    if (error) {
      console.error('upsert failed:', row.station_code, error.message)
      process.exit(1)
    }
  }

  const { data: after, error: afterError } = await supabase
    .from('stations')
    .select('station_code, station_name, station_order')
    .eq('line_number', 1)
    .order('station_order')

  if (afterError) {
    console.error('verify failed:', afterError.message)
    process.exit(1)
  }

  console.log('OK — Incheon Line 1 extension stations added:')
  for (const row of after ?? []) {
    if (['l1-29', 'l1-30', 'l1-31', 'l1-01', 'l1-02', 'l1-05'].includes(row.station_code)) {
      console.log(`  ${row.station_order}\t${row.station_code}\t${row.station_name}`)
    }
  }
}

main()
