/**
 * Production test drive — all lines smoke test
 */
const BASE = process.env.TEST_BASE_URL || 'https://zebssak.vercel.app'

const LINES = [
  { label: '서울 1호선', api: 'seoul1', prefix: 's1', ln: 1, from: '서울역', to: '종로3가' },
  { label: '서울 2호선', api: 'seoul2', prefix: 's2', ln: 2, from: '신도림', to: '강남' },
  { label: '서울 3호선', api: 'seoul3', prefix: 's3', ln: 2, from: '교대', to: '고속터미널' },
  { label: '서울 4호선', api: 'seoul4', prefix: 's4', ln: 2, from: '사당', to: '서울' },
  { label: '서울 5호선', api: 'seoul5', prefix: 's5', ln: 2, from: '여의도', to: '강동' },
  { label: '서울 6호선', api: 'seoul6', prefix: 's6', ln: 2, from: '공덕', to: '합정' },
  { label: '서울 7호선', api: 'seoul7', prefix: 's7', ln: 2, from: '논현', to: '건대입구' },
  { label: '서울 8호선', api: 'seoul8', prefix: 's8', ln: 2, from: '잠실', to: '모란' },
  { label: '서울 9호선', api: 'seoul9', prefix: 's9', ln: 2, from: '신논현', to: '종합운동장' },
  { label: '인천 1호선', api: 'incheon1', prefix: 'l1', ln: 1, from: '부평', to: '예술회관' },
  { label: '인천 2호선', api: 'incheon2', prefix: 'l2', ln: 2, from: '석남', to: '운연' },
]

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

async function registerUser() {
  const username = `td${Date.now().toString().slice(-8)}`
  const { ok, body } = await jsonFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Test1234!' }),
  })
  if (!ok || !body?.data?.token) throw new Error(body?.error || 'register failed')
  return body.data.token
}

const results = []

function log(pass, section, detail) {
  results.push({ pass, section, detail })
  console.log(`${pass ? '✅' : '❌'} ${section}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log(`\n=== Test drive: ${BASE} ===\n`)

  for (const path of [
    '/',
    '/login',
    `/boarding?type=seek&lineLabel=${encodeURIComponent('서울 2호선')}`,
    `/boarding?type=leave&lineLabel=${encodeURIComponent('서울 2호선')}`,
    '/waiting',
  ]) {
    const res = await fetch(`${BASE}${path}`)
    log(res.ok, `PAGE ${path}`, `HTTP ${res.status}`)
  }

  let token
  try {
    token = await registerUser()
    log(Boolean(token), 'AUTH register/login token')
  } catch (e) {
    log(false, 'AUTH', String(e.message))
    return
  }

  for (const c of [
    { text: '강남 가고 싶어 앉고 싶어', mode: 'seek', dest: '강남' },
    { text: '강남에서 내려요', mode: 'leave', dest: '강남' },
  ]) {
    const { ok, body } = await jsonFetch('/api/voice/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ transcript: c.text, lineLabel: '서울 2호선' }),
    })
    const mode = body?.data?.mode
    const dest = body?.data?.destination
    const pass = ok && mode === c.mode && typeof dest === 'string' && dest.includes(c.dest)
    log(pass, `VOICE "${c.text}"`, `mode=${mode}, dest=${dest}`)
  }

  const cong = await jsonFetch('/api/congestion')
  log(cong.ok && cong.body?.success, 'CONGESTION API', JSON.stringify(cong.body?.data?.halted_by_line))

  console.log('\n--- 11 lines ---\n')

  for (const line of LINES) {
    const issues = []

    const st = await jsonFetch(`/api/stations?line=${encodeURIComponent(line.api)}`)
    if (!st.ok || !st.body?.stations?.length) issues.push('stations missing')

    const tr = await jsonFetch(
      `/api/trains?line=${encodeURIComponent(line.api)}&current_station=${encodeURIComponent(line.from)}&station=${encodeURIComponent(line.to)}`
    )
    const trains = Array.isArray(tr.body?.trains) ? tr.body.trains : []
    if (!tr.ok) issues.push(`trains HTTP ${tr.status}`)
    else if (!trains.length) issues.push('trains empty')

    if (trains.length) {
      const dirKeys = new Set(trains.map((t) => t.direction))
      if (dirKeys.size > 2) issues.push(`mixed directions: ${[...dirKeys].join(',')}`)
      const hasBadDisplay = trains.some((t) => /역\s*·/.test(t.direction_display || ''))
      if (hasBadDisplay) issues.push('direction_display still has station prefix')
    }

    const train = trains[0]
    if (train) {
      const seek = await jsonFetch('/api/match-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: 'seeker',
          train_id: train.train_no,
          line_number: line.ln,
          direction: '2',
          car_number: 2,
          seat_side: 'A',
          seat_number: 8,
          destination_id: `${line.prefix}-05`,
          destination_name: line.to,
          boarding_station_id: `${line.prefix}-01`,
          boarding_station_name: line.from,
          remaining_stops: 4,
        }),
      })
      if (!seek.ok || seek.body?.success === false) {
        issues.push(`seek register: ${seek.body?.error || seek.status}`)
      }
    }

    const pass = issues.length === 0
    log(
      pass,
      line.label,
      pass
        ? `${trains.length} trains · direction filter OK · seek 등록 OK`
        : issues.join('; ')
    )
  }

  // seoul2 sindorim->gangnam spot check
  const s2 = await jsonFetch(
    `/api/trains?line=seoul2&current_station=${encodeURIComponent('신도림')}&station=${encodeURIComponent('강남')}`
  )
  const atSindorim = (s2.body?.trains || []).filter((t) => t.station_name === '신도림')
  const s2dirs = [...new Set(atSindorim.map((t) => t.direction_display))]
  log(
    atSindorim.length === 0 || s2dirs.length <= 1,
    '2호선 신도림→강남 방향 필터',
    atSindorim.length
      ? `${atSindorim.length}대 @신도림 · ${s2dirs.join(', ')}`
      : '신도림 열차 없음(실시간) — API 200'
  )

  const failed = results.filter((r) => !r.pass)
  console.log(`\n=== RESULT: ${results.length - failed.length}/${results.length} passed ===\n`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
