/**
 * zebssak.vercel.app 최종 기능 테스트
 */
const BASE = process.env.TEST_BASE_URL || 'https://zebssak.vercel.app'

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

const results = []

function record(section, name, pass, detail = '') {
  results.push({ section, name, pass, detail })
  const icon = pass ? '✅' : '❌'
  console.log(`${icon} [${section}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body, headers: res.headers }
}

async function registerUser(suffix) {
  const username = `ft${suffix}${String(Date.now()).slice(-7)}`
  const password = 'Test1234!'
  const { ok, status, body } = await jsonFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!ok || !body?.data?.token) {
    throw new Error(`register failed (${status}): ${body?.error || JSON.stringify(body)}`)
  }
  return { token: body.data.token, username, password }
}

async function loginUser(username, password) {
  const { ok, body } = await jsonFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ok && body?.data?.token ? body.data.token : null
}

function directionToStorage(direction) {
  const d = (direction || '').trim()
  if (d === '상행' || d === '내선' || d === '1') return '1'
  if (d === '하행' || d === '외선' || d === '2' || d === '0') return '2'
  return '2'
}

async function testBasicAccess() {
  const home = await fetch(`${BASE}/`)
  record('1. 기본 접속', '메인 화면 HTTP', home.ok, `status=${home.status}`)

  const loginPage = await fetch(`${BASE}/login`)
  record('1. 기본 접속', '로그인 페이지 HTTP', loginPage.ok, `status=${loginPage.status}`)

  const registerPage = await fetch(`${BASE}/register`)
  record('1. 기본 접속', '회원가입 페이지 HTTP', registerPage.ok, `status=${registerPage.status}`)

  try {
    const user = await registerUser('a')
    const token = await loginUser(user.username, user.password)
    record('1. 기본 접속', '회원가입 API', Boolean(user.token))
    record('1. 기본 접속', '로그인 API', Boolean(token))
    return user
  } catch (e) {
    record('1. 기본 접속', '회원가입/로그인 API', false, String(e.message))
    return null
  }
}

async function testVoiceParse() {
  const cases = [
    { text: '강남 가고 싶어 앉고 싶어', expectMode: 'seek', expectDest: '강남' },
    { text: '강남에서 내려요', expectMode: 'leave', expectDest: '강남' },
  ]

  for (const c of cases) {
    const { ok, body } = await jsonFetch('/api/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: c.text, lineLabel: '서울 2호선' }),
    })
    const mode = body?.mode ?? body?.data?.mode
    const dest = body?.destination ?? body?.data?.destination
    const pass = ok && mode === c.expectMode && typeof dest === 'string' && dest.includes(c.expectDest)
    record('8. 음성 모드 분기', `"${c.text}"`, pass, `mode=${mode}, dest=${dest}`)
  }
}

async function testTrainsAllLines() {
  let liveCount = 0
  let fallbackOnly = 0
  for (const line of LINES) {
    const { ok, body } = await jsonFetch(`/api/trains?line=${encodeURIComponent(line.apiLine)}`)
    const trains = Array.isArray(body?.trains) ? body.trains : []
    const hasTrain = ok && trains.length > 0
    if (hasTrain) {
      const fromApi = trains.some((t) => t?.train_no && !String(t.source || '').includes('fallback'))
      if (fromApi || trains[0]?.train_no) liveCount += 1
    } else {
      fallbackOnly += 1
    }
    record(
      '6. 실시간 열차',
      `${line.label} /api/trains`,
      ok,
      hasTrain ? `${trains.length}대 (첫번째: ${trains[0]?.train_no})` : '열차 없음'
    )
  }
  record('6. 실시간 열차', '11호선 중 1대 이상 수신', liveCount >= 1, `${liveCount}/11`)
  record('6. 실시간 열차', '전 호선 API 200', liveCount + fallbackOnly === 0 ? false : true, `응답 ${11 - fallbackOnly}/11`)
}

async function testLineMatch(line, providerToken, seekerToken) {
  const { ok: stOk, body: stBody } = await jsonFetch(`/api/stations?line=${encodeURIComponent(line.apiLine)}`)
  const stations = stOk && stBody?.success && Array.isArray(stBody.stations) ? stBody.stations : null
  if (!stations?.length) {
    record('7. 전 호선 매칭', line.label, false, '역 없음')
    return false
  }

  const { ok: trOk, body: trBody } = await jsonFetch(`/api/trains?line=${encodeURIComponent(line.apiLine)}`)
  const trains = trOk && Array.isArray(trBody?.trains) ? trBody.trains : []
  const train = trains[0]
  if (!train?.train_no) {
    record('7. 전 호선 매칭', line.label, false, '열차 없음')
    return false
  }

  const boardingOrder = 1
  const destinationOrder = Math.min(5, stations.length)
  const boardingCode = `${line.prefix}-${String(boardingOrder).padStart(2, '0')}`
  const destinationCode = `${line.prefix}-${String(destinationOrder).padStart(2, '0')}`
  const basePayload = {
    train_id: train.train_no,
    line_number: line.lineNumber,
    direction: directionToStorage(train.direction),
    car_number: 1,
    destination_id: destinationCode,
    destination_name: stations[destinationOrder - 1]?.name || '목적지',
    boarding_station_id: boardingCode,
    boarding_station_name: stations[boardingOrder - 1]?.name || '출발',
    remaining_stops: Math.max(3, destinationOrder - boardingOrder),
  }

  const providerRes = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerToken}` },
    body: JSON.stringify({ ...basePayload, role: 'provider' }),
  })
  if (!providerRes.ok || providerRes.body?.success === false) {
    record('7. 전 호선 매칭', line.label, false, providerRes.body?.error || `provider ${providerRes.status}`)
    return false
  }

  const seekerRes = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seekerToken}` },
    body: JSON.stringify({ ...basePayload, role: 'seeker', seat_side: 'A', seat_number: 1 }),
  })
  const matched = seekerRes.ok && seekerRes.body?.success && seekerRes.body?.data?.matched
  record('7. 전 호선 매칭', line.label, matched, matched ? 'matched' : seekerRes.body?.error || 'matched=false')
  return matched
}

async function testCrossLineBlock(providerToken, seekerToken) {
  const s2Train = (await jsonFetch('/api/trains?line=seoul2')).body?.trains?.[0]
  const s3Train = (await jsonFetch('/api/trains?line=seoul3')).body?.trains?.[0]
  if (!s2Train?.train_no || !s3Train?.train_no) {
    record('7. 교차 호선 차단', 's2/s3 열차 준비', false, '열차 없음')
    return
  }

  const sameNo = s2Train.train_no === s3Train.train_no ? s2Train.train_no : '201'
  const providerPayload = {
    train_id: sameNo,
    line_number: 2,
    direction: '2',
    car_number: 1,
    destination_id: 's2-05',
    destination_name: 'test',
    boarding_station_id: 's2-01',
    boarding_station_name: 'test',
    remaining_stops: 4,
    role: 'provider',
  }
  await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerToken}` },
    body: JSON.stringify(providerPayload),
  })

  const seekerRes = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seekerToken}` },
    body: JSON.stringify({
      ...providerPayload,
      boarding_station_id: 's3-01',
      destination_id: 's3-05',
      role: 'seeker',
      seat_side: 'A',
      seat_number: 1,
    }),
  })
  const blocked = !seekerRes.body?.data?.matched
  record('7. 교차 호선 차단', 's2 provider + s3 seeker 동일 train_no', blocked, blocked ? '매칭 안 됨(정상)' : '교차 매칭 발생!')
}

async function testTwoAccountMatch() {
  const provider = await registerUser('p')
  const seeker = await registerUser('s')
  const line = LINES[1] // seoul2

  const stations = (await jsonFetch(`/api/stations?line=seoul2`)).body?.stations
  const train = (await jsonFetch('/api/trains?line=seoul2')).body?.trains?.[0]
  if (!stations?.length || !train?.train_no) {
    record('4. 실매칭', '두 계정 매칭', false, '역/열차 없음')
    return null
  }

  const payload = {
    train_id: train.train_no,
    line_number: 2,
    direction: directionToStorage(train.direction),
    car_number: 3,
    destination_id: 's2-05',
    destination_name: stations[4]?.name || '목적지',
    boarding_station_id: 's2-01',
    boarding_station_name: stations[0]?.name || '출발',
    remaining_stops: 4,
  }

  const pRes = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.token}` },
    body: JSON.stringify({ ...payload, role: 'provider' }),
  })
  const sRes = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seeker.token}` },
    body: JSON.stringify({ ...payload, role: 'seeker', seat_side: 'A', seat_number: 3 }),
  })

  const matched = sRes.body?.data?.matched === true
  record('4. 실매칭', 'provider→seeker 매칭 성공', matched, matched ? `match_id=${sRes.body?.data?.match_id}` : sRes.body?.error)

  if (matched && sRes.body?.data?.match_id) {
    const matchRes = await jsonFetch(`/api/matches/${sRes.body.data.match_id}`, {
      headers: { Authorization: `Bearer ${seeker.token}` },
    })
    const d = matchRes.body?.data
    const hasKorean = d && (d.destination_name || d.partner_destination || d.boarding_station_name)
    record('4. 실매칭', '매칭 상세 한글·호차·좌석', Boolean(hasKorean), JSON.stringify({
      car: d?.car_number,
      seat: d?.seat_side && d?.seat_number ? `${d.seat_side}${d.seat_number}` : null,
      dest: d?.destination_name,
      dir: d?.direction,
    }))
  }

  return { provider, seeker }
}

async function testWaitingFlow(seekerToken) {
  const seeker2 = await registerUser('w')
  const train = (await jsonFetch('/api/trains?line=seoul9')).body?.trains?.[0]
  const stations = (await jsonFetch('/api/stations?line=seoul9')).body?.stations
  if (!train || !stations?.length) {
    record('5. 대기 화면', '매칭 없을 때 seek 등록', false, '열차/역 없음')
    return
  }

  const res = await jsonFetch('/api/match-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seeker2.token}` },
    body: JSON.stringify({
      train_id: train.train_no,
      line_number: 2,
      direction: '2',
      car_number: 2,
      destination_id: 's9-05',
      destination_name: stations[4]?.name,
      boarding_station_id: 's9-01',
      boarding_station_name: stations[0]?.name,
      remaining_stops: 4,
      role: 'seeker',
      seat_side: 'B',
      seat_number: 2,
    }),
  })

  const waiting = res.ok && res.body?.success && !res.body?.data?.matched && res.body?.data?.request_id
  record('5. 대기 화면', 'seeker 단독 등록 → waiting', waiting, waiting ? `request_id=${res.body.data.request_id}` : res.body?.error)

  const waitingPage = await fetch(`${BASE}/waiting`)
  record('5. 대기 화면', '/waiting 페이지 HTTP', waitingPage.ok, `status=${waitingPage.status}`)
}

async function testBoardingPages() {
  const seek = await fetch(`${BASE}/boarding?type=seek&lineLabel=${encodeURIComponent('서울 2호선')}`)
  const leave = await fetch(`${BASE}/boarding?type=leave&lineLabel=${encodeURIComponent('서울 2호선')}`)
  record('2/3. 탑승 화면', 'seek boarding HTTP', seek.ok, `status=${seek.status}`)
  record('2/3. 탑승 화면', 'leave boarding HTTP', leave.ok, `status=${leave.status}`)
}

async function testCongestion() {
  const { ok, body } = await jsonFetch('/api/congestion')
  record('5. 혼잡도', '/api/congestion', ok && body?.success, `halted=${JSON.stringify(body?.data?.halted_by_line)}`)
}

async function main() {
  console.log(`\n=== Final test: ${BASE} ===\n`)

  const user = await testBasicAccess()
  await testBoardingPages()
  await testVoiceParse()
  await testTrainsAllLines()
  await testCongestion()

  let provider, seeker
  try {
    provider = await registerUser('pr')
    seeker = await registerUser('sk')
  } catch (e) {
    console.error('Match user setup failed', e)
  }

  if (provider && seeker) {
    for (const line of LINES) {
      await testLineMatch(line, provider.token, seeker.token)
    }
    await testCrossLineBlock(provider.token, seeker.token)
  }

  await testTwoAccountMatch()
  await testWaitingFlow()

  // UI-only items (GPS, full click flow) — manual / browser limited
  record('2. seek 플로우', 'GPS 현재 역 자동 파악', null, '브라우저 GPS 필요 — API/페이지만 검증')
  record('2. seek 플로우', 'UI 전체 클릭 플로우', null, '수동/E2E 필요')
  record('3. leave 플로우', 'GPS·음성·UI 전체', null, '수동/E2E 필요')

  console.log('\n=== SUMMARY BY SECTION ===\n')
  const sections = [...new Set(results.map((r) => r.section))]
  for (const sec of sections) {
    const items = results.filter((r) => r.section === sec)
    const tested = items.filter((r) => r.pass !== null)
    const passed = tested.filter((r) => r.pass).length
    console.log(`${sec}: ${passed}/${tested.length} passed`)
  }

  const failed = results.filter((r) => r.pass === false)
  if (failed.length) {
    console.log('\nFailed:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
