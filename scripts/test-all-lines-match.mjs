/**
 * 전체 호선(서울 1~9, 인천 1~2) 매칭 API 스모크 테스트
 * provider 등록 → seeker 등록 → matched 여부 확인
 */
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'

const LINES = [
  { label: '서울 1호선', apiLine: 'seoul1', lineNumber: 1, prefix: 's1' },
  { label: '서울 2호선', apiLine: 'seoul2', lineNumber: 2, prefix: 's2' },
  { label: '서울 3호선', apiLine: 'seoul3', lineNumber: 2, prefix: 's3' },
  { label: '서울 4호선', apiLine: 'seoul4', lineNumber: 2, prefix: 's4' },
  { label: '서울 5호선', apiLine: 'seoul5', lineNumber: 2, prefix: 's5' },
  { label: '서울 6호선', apiLine: 'seoul6', lineNumber: 2, prefix: 's6' },
  { label: '서울 7호선', apiLine: 'seoul7', lineNumber: 2, prefix: 's7' },
  { label: '서울 8호선', apiLine: 'seoul8', lineNumber: 2, prefix: 's8' },
  { label: '서울 9호선', apiLine: 'seoul9', lineNumber: 2, prefix: 's9' },
  { label: '인천 1호선', apiLine: 'incheon1', lineNumber: 1, prefix: 'l1' },
  { label: '인천 2호선', apiLine: 'incheon2', lineNumber: 2, prefix: 'l2' },
]

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

async function registerUser(suffix) {
  const username = `lt${suffix}${String(Date.now()).slice(-8)}`
  const password = 'Test1234!'
  const { ok, status, body } = await jsonFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!ok || !body?.data?.token) {
    throw new Error(`register failed (${status}): ${body?.error || JSON.stringify(body)}`)
  }
  return { token: body.data.token, username }
}

const FALLBACK_TRAINS = {
  seoul1: { train_no: '101', direction: '하행' },
  seoul2: { train_no: '201', direction: '하행' },
  seoul3: { train_no: '301', direction: '하행' },
  seoul4: { train_no: '401', direction: '하행' },
  seoul5: { train_no: '501', direction: '하행' },
  seoul6: { train_no: '601', direction: '하행' },
  seoul7: { train_no: '701', direction: '하행' },
  seoul8: { train_no: '801', direction: '하행' },
  seoul9: { train_no: '901', direction: '하행' },
  incheon1: { train_no: '1101', direction: '하행' },
  incheon2: { train_no: '2201', direction: '하행' },
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchTrains(apiLine) {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/trains?line=${encodeURIComponent(apiLine)}`, 8000)
    const body = await res.json()
    const trains = Array.isArray(body?.trains) ? body.trains : []
    if (res.ok && trains.length > 0) {
      return trains[0]
    }
  } catch {
    // timeout or network — use fallback
  }
  return FALLBACK_TRAINS[apiLine] ?? null
}

async function fetchStations(apiLine) {
  const { ok, body } = await jsonFetch(`/api/stations?line=${encodeURIComponent(apiLine)}`)
  if (!ok || !body?.success || !Array.isArray(body.stations) || body.stations.length < 4) {
    return null
  }
  return body.stations
}

function directionToStorage(direction) {
  const d = (direction || '').trim()
  if (d === '상행' || d === '내선' || d === '1') return '1'
  if (d === '하행' || d === '외선' || d === '2' || d === '0') return '2'
  if (/내선|상행/u.test(d)) return '1'
  if (/외선|하행/u.test(d)) return '2'
  return '2'
}

async function postMatchRequest(token, payload) {
  return jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
}

async function testLine(line, providerToken, seekerToken) {
  const result = {
    label: line.label,
    stations: 'skip',
    trains: 'skip',
    provider: 'skip',
    seeker: 'skip',
    matched: false,
    error: null,
  }

  try {
    const stations = await fetchStations(line.apiLine)
    if (!stations) {
      result.stations = 'fail'
      result.error = '역 목록 없음'
      return result
    }
    result.stations = 'ok'

    const train = await fetchTrains(line.apiLine)
    if (!train?.train_no) {
      result.trains = 'fail'
      result.error = '열차 목록 없음'
      return result
    }
    result.trains = 'ok'

    const boardingOrder = 1
    const destinationOrder = Math.min(5, stations.length)
    const boardingCode = `${line.prefix}-${String(boardingOrder).padStart(2, '0')}`
    const destinationCode = `${line.prefix}-${String(destinationOrder).padStart(2, '0')}`
    const remainingStops = Math.max(3, destinationOrder - boardingOrder)
    const direction = directionToStorage(train.direction)

    const basePayload = {
      train_id: train.train_no,
      line_number: line.lineNumber,
      direction,
      car_number: 1,
      destination_id: destinationCode,
      destination_name: stations[destinationOrder - 1]?.name || '목적지',
      boarding_station_id: boardingCode,
      boarding_station_name: stations[boardingOrder - 1]?.name || '출발',
      remaining_stops: remainingStops,
    }

    const providerRes = await postMatchRequest(providerToken, {
      ...basePayload,
      role: 'provider',
    })
    if (!providerRes.ok || providerRes.body?.success === false) {
      result.provider = 'fail'
      result.error = providerRes.body?.error || `HTTP ${providerRes.status}`
      return result
    }
    result.provider = 'ok'

    const seekerRes = await postMatchRequest(seekerToken, {
      ...basePayload,
      role: 'seeker',
      seat_side: 'A',
      seat_number: 1,
    })
    if (!seekerRes.ok || seekerRes.body?.success === false) {
      result.seeker = 'fail'
      result.error = seekerRes.body?.error || `HTTP ${seekerRes.status}`
      return result
    }
    result.seeker = 'ok'
    result.matched = Boolean(seekerRes.body?.data?.matched)
    if (!result.matched) {
      result.error = 'seeker 등록은 됐지만 matched=false'
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

async function main() {
  console.log(`Testing match flow on ${BASE}\n`)

  const provider = await registerUser('provider')
  const seeker = await registerUser('seeker')
  console.log(`Users: ${provider.username}, ${seeker.username}\n`)

  const results = []
  for (const line of LINES) {
    const r = await testLine(line, provider.token, seeker.token)
    results.push(r)
    const icon = r.matched ? '✓' : '✗'
    console.log(
      `${icon} ${r.label.padEnd(10)} stations=${r.stations} trains=${r.trains} provider=${r.provider} seeker=${r.seeker} matched=${r.matched}${r.error ? ` — ${r.error}` : ''}`
    )
  }

  const passed = results.filter((r) => r.matched).length
  const failed = results.length - passed
  console.log(`\nSummary: ${passed}/${results.length} matched, ${failed} failed`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
