import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNDNmMDRiYS01YjU0LTQ1ZDQtYWU5Zi0zOTYxYzYxYmZlNzMiLCJ1c2VybmFtZSI6InNzMDM5NTY2NCIsImlhdCI6MTc4MDI5MDM5NSwiZXhwIjoxNzgwODk1MTk1fQ.qvJlKYr7sXmS6Twsp-6k-5STxCpu8fGZzLhHtER0bV0'
const OUT = path.join(__dirname, '..', 'e2e-screenshots', 'incheon-timetable-trains.png')

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify({ username: 'ss0395664' }))
      sessionStorage.setItem(
        'boardingDetectedLocation',
        JSON.stringify({
          lineLabel: '인천 1호선',
          nearestStationName: '간석오거리',
          within1km: true,
          detectedAt: Date.now(),
        })
      )
      sessionStorage.setItem('boardingFlowKey', '인천 1호선|seek')
    },
    { token: TOKEN }
  )

  await page.goto(
    `http://localhost:3000/boarding?type=seek&lineLabel=${encodeURIComponent('인천 1호선')}`,
    { waitUntil: 'load', timeout: 60000 }
  )

  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('로딩 중...'),
      null,
      { timeout: 45000 }
    )
  } catch (err) {
    const debugText = await page.evaluate(() => document.body.innerText)
    console.error('STUCK_TEXT:', debugText.slice(0, 800))
    throw err
  }

  const destinationInput = page.locator('input').filter({ hasNot: page.locator('[readonly]') }).first()
  await destinationInput.fill('원인재')
  await page.waitForTimeout(800)

  const destinationOption = page.getByRole('button', { name: /원인재/ }).first()
  await destinationOption.click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: '다음 — 열차 선택' }).click()

  await page.waitForFunction(
    () => document.body.innerText.includes('열차 선택') && !document.body.innerText.includes('열차 불러오는 중'),
    null,
    { timeout: 30000 }
  )
  await page.waitForTimeout(1500)

  const text = await page.evaluate(() => document.body.innerText)
  console.log('PAGE_TEXT_SNIPPET:', text.slice(0, 600))

  await page.screenshot({ path: OUT, fullPage: true })
  console.log('SCREENSHOT_SAVED:', OUT)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
