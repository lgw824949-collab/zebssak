import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'

const ORDER = [
  '검단호수공원',
  '신검단중앙',
  '아라',
  '계양',
  '귤현',
  '박촌',
  '임학',
  '계산',
  '경인교대입구',
  '작전',
  '갈산',
  '부평구청',
  '부평시장',
  '부평',
  '동수',
  '부평삼거리',
  '간석오거리',
  '인천시청',
  '예술회관',
  '인천터미널',
  '문학경기장',
  '선학',
  '신연수',
  '원인재',
  '동춘',
  '캠퍼스타운',
  '테크노파크',
  '지식정보단지',
  '인천대입구',
  '센트럴파크',
  '국제업무지구',
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  for (let i = 0; i < ORDER.length; i += 1) {
    const station_name = ORDER[i]
    const station_order = i + 1
    const station_code = `l1-${String(i + 1).padStart(2, '0')}`

    const { error } = await supabase.from('stations').upsert(
      { station_code, station_name, line_number: 1, station_order },
      { onConflict: 'station_code' }
    )
    if (error) {
      console.error(station_name, error.message)
      process.exit(1)
    }
  }
  console.log('OK', ORDER.slice(0, 7).join(' → '))
}

main()
