'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

function resolveApiLineNumber(lineLabel) {
  const normalized = (lineLabel || '').replace(/\s+/g, '')
  if (normalized.includes('1호선')) return 1
  return 2
}

function resolveDestinationCodePrefix(lineLabel) {
  const normalized = (lineLabel || '').replace(/\s+/g, '')
  const incheon = normalized.match(/^인천([12])호선$/)
  if (incheon?.[1]) return `l${incheon[1]}`
  const seoul = normalized.match(/^서울([1-9])호선$/)
  if (seoul?.[1]) return `s${seoul[1]}`
  return 's1'
}

export default function LeaveRequest({ line = '서울 1호선' }) {
  const [step, setStep] = useState(1)
  const [trains, setTrains] = useState([])
  const [trainNo, setTrainNo] = useState('')
  const [carNumber, setCarNumber] = useState(null)
  const [direction, setDirection] = useState('하행')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [completedId, setCompletedId] = useState('')

  const apiLineNumber = useMemo(() => resolveApiLineNumber(line), [line])
  const destinationPrefix = useMemo(() => resolveDestinationCodePrefix(line), [line])

  useEffect(() => {
    let active = true
    const supabase = getSupabase()

    async function loadTrainList() {
      try {
        const { data } = await supabase
          .from('trains')
          .select('train_no')
          .eq('line_number', apiLineNumber)
          .order('updated_at', { ascending: false })
          .limit(20)
        if (!active) return
        const list = Array.from(
          new Set(
            (data ?? [])
              .map((row) => row?.train_no?.trim())
              .filter(Boolean)
          )
        )
        setTrains(list)
      } catch {
        if (!active) return
        setTrains([])
      }
    }

    void loadTrainList()
    return () => {
      active = false
    }
  }, [apiLineNumber])

  async function handleSubmit() {
    const normalizedTrainNo = trainNo.trim()
    if (!normalizedTrainNo || !carNumber) {
      setError('열차 번호와 칸 번호를 확인해 주세요.')
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      setError('로그인이 필요합니다.')
      return
    }

    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/match-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: 'provider',
          train_id: normalizedTrainNo,
          line_number: apiLineNumber,
          direction,
          car_number: carNumber,
          destination_id: `${destinationPrefix}-99`,
          destination_name: '하차 예정',
          remaining_stops: 3,
          boarding_station_id: `${destinationPrefix}-01`,
          boarding_station_name: '현재 탑승역',
        }),
      })

      const result = await response.json()
      if (!response.ok || result?.success === false) {
        setError(result?.error || '하차 등록에 실패했습니다.')
        return
      }

      setCompletedId(result?.data?.match_request_id || '')
      setStep(4)
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', minHeight: '100dvh', background: '#F8FAFC' }}>
      <div style={{ padding: 16, borderBottom: '1px solid #E2E8F0', background: '#FFFFFF' }}>
        <div style={{ fontSize: 12, color: '#6B7280' }}>{line}</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 800, color: '#111827' }}>
          내릴게요
        </h1>
      </div>

      <div style={{ padding: 16 }}>
        {step === 1 && (
          <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>1. 현재 열차 선택</h2>
            <p style={{ marginTop: 8, color: '#6B7280', fontSize: 13 }}>직접 입력하거나 목록에서 선택해 주세요.</p>
            <input
              value={trainNo}
              onChange={(event) => setTrainNo(event.target.value)}
              placeholder="열차 번호 입력"
              style={{
                width: '100%',
                height: 42,
                marginTop: 10,
                border: '1px solid #CBD5E1',
                borderRadius: 10,
                padding: '0 12px',
                fontSize: 14,
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {trains.map((row) => (
                <button
                  key={row}
                  type="button"
                  onClick={() => setTrainNo(row)}
                  style={{
                    border: '1px solid #CBD5E1',
                    borderRadius: 999,
                    padding: '6px 10px',
                    fontSize: 13,
                    background: trainNo === row ? '#E0ECFF' : '#FFFFFF',
                    color: '#111827',
                  }}
                >
                  {row}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!trainNo.trim()}
              style={{
                marginTop: 14,
                width: '100%',
                height: 44,
                border: 'none',
                borderRadius: 10,
                background: trainNo.trim() ? '#1D4ED8' : '#93C5FD',
                color: '#FFFFFF',
                fontWeight: 700,
              }}
            >
              다음
            </button>
          </section>
        )}

        {step === 2 && (
          <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>2. 칸 번호 선택</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setCarNumber(num)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    border: carNumber === num ? '1px solid #1D4ED8' : '1px solid #CBD5E1',
                    background: carNumber === num ? '#1D4ED8' : '#FFFFFF',
                    color: carNumber === num ? '#FFFFFF' : '#111827',
                    fontWeight: 700,
                  }}
                >
                  {num}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, color: '#4B5563' }}>방향</label>
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                style={{
                  width: '100%',
                  height: 42,
                  marginTop: 6,
                  border: '1px solid #CBD5E1',
                  borderRadius: 10,
                  padding: '0 10px',
                }}
              >
                <option value="상행">상행</option>
                <option value="하행">하행</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!carNumber}
              style={{
                marginTop: 14,
                width: '100%',
                height: 44,
                border: 'none',
                borderRadius: 10,
                background: carNumber ? '#1D4ED8' : '#93C5FD',
                color: '#FFFFFF',
                fontWeight: 700,
              }}
            >
              다음
            </button>
          </section>
        )}

        {step === 3 && (
          <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>3. 하차 등록</h2>
            <p style={{ marginTop: 10, fontSize: 14, color: '#374151' }}>
              열차 <strong>{trainNo}</strong> / <strong>{carNumber}칸</strong> / <strong>{direction}</strong>
            </p>
            {error ? (
              <p style={{ marginTop: 10, color: '#DC2626', fontSize: 13 }}>{error}</p>
            ) : null}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                marginTop: 14,
                width: '100%',
                height: 44,
                border: 'none',
                borderRadius: 10,
                background: '#1D4ED8',
                color: '#FFFFFF',
                fontWeight: 700,
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? '등록 중...' : '하차 등록'}
            </button>
          </section>
        )}

        {step === 4 && (
          <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>✅</div>
            <h2 style={{ margin: '10px 0 6px', fontSize: 20, fontWeight: 800 }}>등록 완료</h2>
            <p style={{ margin: 0, fontSize: 14, color: '#6B7280' }}>
              하차 예정 정보가 저장되었습니다.
            </p>
            {completedId ? (
              <p style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF' }}>요청 ID: {completedId}</p>
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}

