import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import SubwaySeatMap, { mapSeatIdToApi } from "@/components/SubwaySeatMap";
import { normalizeDirectionForStorage } from "@/lib/match-direction";

function resolveApiLineFromLineProp(lineLabel) {
  const seoulMatch = lineLabel.match(/서울\s*([1-9])호선/u);
  if (seoulMatch?.[1]) {
    return `seoul${seoulMatch[1]}`;
  }

  const incheonMatch = lineLabel.match(/인천\s*([12])호선/u);
  if (incheonMatch?.[1]) {
    return `incheon${incheonMatch[1]}`;
  }

  return null;
}

/** 서울 1~9호선 — 실시간·좌석 선택 지원 */
function isSeoulLineFromLineProp(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  return typeof apiLine === "string" && apiLine.startsWith("seoul");
}

function resolveLineNumberFromLineProp(lineLabel) {
  const normalized = (lineLabel || "").replace(/\s+/g, "");
  if (normalized === "인천1호선" || /^서울1호선$/.test(normalized)) return 1;
  return 2;
}

function resolveStationCodePrefixFromLineProp(lineLabel) {
  const normalized = (lineLabel || "").replace(/\s+/g, "");
  const incheonMatch = normalized.match(/^인천([12])호선$/);
  if (incheonMatch?.[1]) return `l${incheonMatch[1]}`;
  const seoulMatch = normalized.match(/^서울([1-9])호선$/);
  if (seoulMatch?.[1]) return `s${seoulMatch[1]}`;
  return "s1";
}

/** 호선별 객실 레이아웃 (SubwaySeatMap LINE_CAR_LAYOUT과 동일) */
const LINE_CAR_LAYOUT = {
  seoul1: {
    doorCount: 4,
    seatsPerSection: 8,
    prioritySeats: 3,
    carCount: 10,
  },
  seoul2: {
    doorCount: 4,
    seatsPerSection: 7,
    prioritySeats: 3,
    carCount: 10,
  },
  seoul3: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul4: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul5: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul6: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul7: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul8: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  seoul9: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  incheon1: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  incheon2: { doorCount: 4, seatsPerSection: 7, prioritySeats: 3, carCount: 6 },
  defaultMetro: {
    doorCount: 4,
    seatsPerSection: 7,
    prioritySeats: 3,
    carCount: 6,
  },
};

const DEFAULT_CAR_LAYOUT = LINE_CAR_LAYOUT.defaultMetro;

function normalizeLineLabelCompact(lineLabel) {
  const primary = (lineLabel || "").split("·")[0].trim();
  return primary.replace(/\s+/g, "");
}

function resolveLineLayoutKey(lineLabel) {
  const normalized = normalizeLineLabelCompact(lineLabel);
  if (/^서울1호선$/.test(normalized)) return "seoul1";
  if (/^서울2호선$/.test(normalized)) return "seoul2";
  const seoulN = normalized.match(/^서울([3-9])호선$/);
  if (seoulN?.[1]) return `seoul${seoulN[1]}`;
  const incheonN = normalized.match(/^인천([12])호선$/);
  if (incheonN?.[1]) return `incheon${incheonN[1]}`;
  const bare = normalized.match(/^([1-9])호선$/);
  if (bare?.[1] === "1") return "seoul1";
  if (bare?.[1] === "2") return "seoul2";
  if (bare?.[1]) return "defaultMetro";
  return "defaultMetro";
}

function resolveCarLayout(lineLabel) {
  const key = resolveLineLayoutKey(lineLabel);
  return LINE_CAR_LAYOUT[key] ?? DEFAULT_CAR_LAYOUT;
}

function resolveCarCountFromLineProp(lineLabel) {
  return resolveCarLayout(lineLabel).carCount;
}

function resolveApiLineKeyFromLineProp(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  if (apiLine) return apiLine;
  const normalized = normalizeLineLabelCompact(lineLabel);
  if (/^서울1호선$/.test(normalized)) return "seoul1";
  if (/^서울2호선$/.test(normalized)) return "seoul2";
  return "seoul2";
}

/** 호선별 역 목록 (서버 API — DB/RLS 없이 한글 역명 보장) */
async function fetchStationsForLine(lineLabel) {
  const apiLine = resolveApiLineFromLineProp(lineLabel);
  if (!apiLine) return null;

  try {
    const response = await fetch(
      `/api/stations?line=${encodeURIComponent(apiLine)}`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload?.success || !Array.isArray(payload.stations)) {
      return null;
    }
    return payload.stations;
  } catch {
    return null;
  }
}

function stationMatchesSearch(stationName, rawQuery) {
  const searchName = normalizeStationSearchTerm(stationName);
  const searchTerm = normalizeStationSearchTerm(rawQuery);
  if (!searchTerm) return false;
  return searchName.includes(searchTerm);
}

/** 역명으로 station_code·순서 조회 */
async function lookupStationMeta(stationName, lineLabel) {
  const searchName = normalizeStationSearchTerm(stationName);
  if (!searchName) return null;

  const stations = await fetchStationsForLine(lineLabel);
  if (!stations?.length) return null;

  const prefix = resolveStationCodePrefixFromLineProp(lineLabel);
  const exactIndex = stations.findIndex(
    (row) => normalizeStationSearchTerm(row?.name) === searchName
  );
  const partialIndex =
    exactIndex >= 0
      ? exactIndex
      : stations.findIndex((row) => stationMatchesSearch(row?.name, stationName));

  if (partialIndex < 0) return null;

  const row = stations[partialIndex];
  const order = row.order ?? partialIndex + 1;
  const stationCode = `${prefix}-${String(order).padStart(2, "0")}`;

  return {
    stationCode,
    stationName: row.name,
    stationOrder: order,
  };
}

function resolveRemainingStops(boardingOrder, destinationOrder) {
  if (
    Number.isFinite(boardingOrder) &&
    Number.isFinite(destinationOrder) &&
    destinationOrder > boardingOrder
  ) {
    return Math.max(3, destinationOrder - boardingOrder);
  }
  return 3;
}

/** 열차 방면 표시(예: 역삼 방면) → 빠른하차 drtnInfo */
function resolveDrtnInfoFromDirectionDisplay(directionDisplay) {
  const value = (directionDisplay || "").trim();
  const match = value.match(/^(.+?)\s*방면$/);
  if (!match?.[1]) return "";
  return match[1].trim().replace(/역$/, "");
}

function normalizeLineLabel(lineLabel) {
  const value = typeof lineLabel === "string" ? lineLabel.trim() : "";
  if (value && !value.includes("??") && value.includes("호선")) {
    return value;
  }

  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("lineLabel");
    const queryValue = fromQuery?.trim() || "";
    if (queryValue && !queryValue.includes("??") && queryValue.includes("호선")) {
      return queryValue;
    }
  }

  return "서울 1호선";
}

// ─── 색상 ────────────────────────────────────────────────────────
const C = {
  primary: "#1A56A0",
  primaryLight: "#E3F0FF",
  primaryBorder: "#90BEF0",
  bg: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#1A1A1A",
  muted: "#888",
  priority: { bg: "#FFF3E0", border: "#FFB74D", text: "#E65100" },
  occupied: { bg: "#EBEBEB", border: "#D0D0D0", text: "#888" },
};

/** 검색어 정규화 — "강남역" → "강남" (역명 목록 기준) */
function normalizeStationSearchTerm(value) {
  return (value || "").trim().replace(/\s+/g, "").replace(/역$/u, "");
}

function formatStationDisplayName(stationName) {
  const name = (stationName || "").trim();
  if (!name) return "";
  return name.endsWith("역") ? name : `${name}역`;
}

// ─── 공통 컴포넌트 ────────────────────────────────────────────────
function Header({ step, onBack, title, line }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "14px 16px 10px",
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
      position: "sticky", top: 0, zIndex: 10,
    }}>
      <button onClick={onBack} style={{
        background: "none", border: "none", cursor: "pointer",
        padding: 4, color: C.text, fontSize: 20, lineHeight: 1,
        display: "flex", alignItems: "center",
      }}>
        ←
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 1 }}>{line}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
      </div>
      <div style={{
        fontSize: 11, color: C.primary, fontWeight: 600,
        background: C.primaryLight, borderRadius: 20, padding: "3px 10px",
      }}>
        {step} / 3
      </div>
    </div>
  );
}

function StepDots({ step }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: "12px 0 0" }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          width: i === step ? 20 : 6,
          height: 6,
          borderRadius: 3,
          background: i === step ? C.primary : C.border,
          transition: "width 0.2s",
        }} />
      ))}
    </div>
  );
}

function BottomButton({ label, onClick, disabled }) {
  return (
    <div style={{ padding: "12px 16px 24px", background: C.card, borderTop: `1px solid ${C.border}` }}>
      <button onClick={onClick} disabled={disabled} style={{
        width: "100%", padding: "15px 0",
        background: disabled ? "#C5D8EF" : C.primary,
        color: "#fff", border: "none", borderRadius: 12,
        fontSize: 16, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        transition: "background 0.2s",
      }}>
        {label}
      </button>
    </div>
  );
}

// ─── Step 1: 하차역 검색 ─────────────────────────────────────────
function StepStation({ line, mode, onNext, onBack }) {
  const isLeaveMode = mode === "leave";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef(null);
  const apiLine = resolveApiLineFromLineProp(line);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function startVoiceSearch() {
    setVoiceError("");
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("이 브라우저는 음성 입력을 지원하지 않습니다.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ko-KR";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsListening(true);
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setQuery(transcript);
          setSelected(null);
        }
      };
      recognition.onerror = () => {
        setVoiceError("음성을 인식하지 못했습니다. 다시 시도해 주세요.");
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError("음성 입력을 시작할 수 없습니다.");
    }
  }

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();

    const searchTerm = normalizeStationSearchTerm(trimmed);
    if (searchTerm.length < 1) {
      setResults([]);
      setSearchError("");
      return () => {
        active = false;
      };
    }

    if (!apiLine) {
      setResults([]);
      setSearchError("이 노선은 역 검색을 지원하지 않습니다.");
      return () => {
        active = false;
      };
    }

    const loadStations = async () => {
      setSearchError("");
      try {
        const stations = await fetchStationsForLine(line);
        if (!active) return;

        if (!stations) {
          setResults([]);
          setSearchError("역 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }

        const names = stations
          .map((row) => row?.name?.trim())
          .filter((name) => name && stationMatchesSearch(name, trimmed))
          .slice(0, 8);

        setResults(names);
        if (names.length === 0) {
          setSearchError("");
        }
      } catch {
        if (!active) return;
        setResults([]);
        setSearchError("역 검색 중 오류가 발생했습니다.");
      }
    };

    void loadStations();
    return () => {
      active = false;
    };
  }, [query, line, apiLine]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header
        step={1}
        onBack={onBack}
        title={isLeaveMode ? "내릴 역 선택" : "하차역 선택"}
        line={line}
      />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0" }}>
        <StepDots step={1} />
        <div style={{ marginTop: 16, position: "relative" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); }}
            placeholder="역 이름 검색 (예: 간석, 강남)"
            style={{
              width: "100%", padding: "13px 16px 13px 42px",
              border: `1.5px solid ${query ? C.primary : C.border}`,
              borderRadius: 12, fontSize: 15,
              background: C.card, outline: "none",
              boxSizing: "border-box",
              transition: "border 0.2s",
            }}
          />
          <span style={{
            position: "absolute", left: 14, top: "50%",
            transform: "translateY(-50%)", fontSize: 18, color: C.muted,
          }}>🔍</span>
          {query && (
            <button onClick={() => { setQuery(""); setSelected(null); }} style={{
              position: "absolute", right: 12, top: "50%",
              transform: "translateY(-50%)",
              background: "#D0D0D0", border: "none",
              width: 20, height: 20, borderRadius: 10,
              fontSize: 12, color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          )}
        </div>
        <button
          type="button"
          onClick={startVoiceSearch}
          disabled={isListening}
          style={{
            marginTop: 8,
            width: "100%",
            padding: "10px 0",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: isListening ? C.primaryLight : C.card,
            color: C.primary,
            fontSize: 13,
            fontWeight: 600,
            cursor: isListening ? "default" : "pointer",
          }}
        >
          {isListening ? "듣는 중..." : "🎤 음성으로 역 검색"}
        </button>
        {voiceError ? (
          <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{voiceError}</p>
        ) : null}
        {searchError ? (
          <p style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{searchError}</p>
        ) : null}

        {/* 검색 결과 */}
        {results.length > 0 && (
          <div style={{
            marginTop: 8, background: C.card,
            border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {results.map((station, i) => (
              <button key={station} onClick={() => { setSelected(station); setQuery(station); }} style={{
                width: "100%", padding: "13px 16px",
                background: selected === station ? C.primaryLight : C.card,
                border: "none",
                borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 15,
                color: selected === station ? C.primary : C.text,
                fontWeight: selected === station ? 600 : 400,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: selected === station ? C.primary : "#F0F4F8",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                  color: selected === station ? "#fff" : C.muted,
                }}>역</span>
                {formatStationDisplayName(station)}
              </button>
            ))}
          </div>
        )}

        {query.length >= 1 && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 14 }}>
            &quot;{query}&quot;에 해당하는 역이 없어요
          </div>
        )}

        {!query && (
          <div style={{ textAlign: "center", padding: "40px 0 0", color: "#C0C0C0", fontSize: 13, lineHeight: 1.6 }}>
            {isLeaveMode
              ? "이번에 내릴 역을 검색해 주세요"
              : "역 이름을 입력하면 자동으로 나타나요"}
          </div>
        )}
      </div>
      <BottomButton
        label={isLeaveMode ? "다음 — 열차 선택" : "다음 — 열차 선택"}
        onClick={() => onNext(selected)}
        disabled={!selected}
      />
    </div>
  );
}

// ─── Step 2: 열차 선택 ───────────────────────────────────────────
function StepTrain({ line, station, currentStation, mode, onNext, onBack }) {
  const isLeaveMode = mode === "leave";
  const [selected, setSelected] = useState(null);
  const [trains, setTrains] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [platformHint, setPlatformHint] = useState("");
  const apiLine = resolveApiLineFromLineProp(line);

  useEffect(() => {
    const hintStation = (currentStation || "").trim().replace(/역$/, "");
    if (!hintStation || !apiLine) {
      setPlatformHint("");
      return;
    }

    let active = true;
    const lineParam = hintStation && line ? line.match(/(\d)호선/)?.[1] : null;

    const loadPlatformHint = async () => {
      try {
        const seoulLine = line.match(/서울\s*([1-9])호선/u);
        const incheonLine = line.match(/인천\s*([12])호선/u);
        const lineNm = seoulLine?.[1]
          ? `${seoulLine[1]}호선`
          : incheonLine?.[1]
            ? `${incheonLine[1]}호선`
            : lineParam
              ? `${lineParam}호선`
              : "";

        if (!lineNm || incheonLine) {
          if (active) setPlatformHint("");
          return;
        }

        const params = new URLSearchParams({
          station: hintStation,
          line: lineNm,
        });
        const response = await fetch(`/api/quick-exit?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!active || !response.ok) return;

        const items = Array.isArray(payload?.items) ? payload.items : [];
        const first = items[0];
        if (first?.plfmCmgFac) {
          setPlatformHint(`승강장 ${first.plfmCmgFac} 근처 · ${first.qckgffVhclDoorNo ?? ""}`.trim());
        } else {
          setPlatformHint("");
        }
      } catch {
        if (active) setPlatformHint("");
      }
    };

    void loadPlatformHint();
    return () => {
      active = false;
    };
  }, [currentStation, line, apiLine]);

  useEffect(() => {
    if (!apiLine) {
      setTrains([]);
      setSelected(null);
      return;
    }

    let active = true;

    const loadTrains = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          line: apiLine,
          station: station ?? "",
        });
        if (currentStation?.trim()) {
          params.set("current_station", currentStation.trim());
        }
        const response = await fetch(`/api/trains?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("열차 API 호출 실패");
        }
        const payload = await response.json();
        const apiTrains = Array.isArray(payload?.trains) ? payload.trains : [];

        if (!active) return;

        const mapped = apiTrains
          .map((row) => ({
            id: row?.train_no ?? "",
            current: row?.station_name?.trim() || "정보 없음",
            eta: row?.direction_display?.trim() || "운행 정보",
            direction: row?.direction?.trim() || "하행",
          }))
          .filter((row) => row.id);

        setTrains(mapped);
        setSelected((prev) => {
          if (prev && mapped.some((train) => train.id === prev)) return prev;
          return mapped[0]?.id ?? null;
        });
      } catch {
        if (!active) return;
        setTrains([]);
        setSelected(null);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadTrains();

    return () => {
      active = false;
    };
  }, [apiLine, station, currentStation]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={2} onBack={onBack} title="열차 선택" line={line} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0" }}>
        <StepDots step={2} />
        {station ? (
          <div style={{
            marginTop: 16, background: C.primaryLight,
            border: `1px solid ${C.primaryBorder}`,
            borderRadius: 10, padding: "10px 14px",
            fontSize: 13, color: C.primary,
          }}>
            {isLeaveMode ? (
              <>
                <strong>{station}</strong>에서 내립니다
              </>
            ) : (
              <>
                하차 목적지: <strong>{station}</strong>
              </>
            )}
          </div>
        ) : null}
        {platformHint ? (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {platformHint}
          </div>
        ) : null}
        <div style={{ marginTop: 16 }}>
          {isLoading ? (
            <div style={{ color: C.muted, fontSize: 14 }}>열차 목록 불러오는 중…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {trains.map((train) => {
                const isSelected = selected === train.id;
                return (
                  <button
                    key={train.id}
                    type="button"
                    onClick={() => setSelected(train.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: `1.5px solid ${isSelected ? C.primary : C.border}`,
                      background: isSelected ? C.primary : C.card,
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: isSelected ? "rgba(255,255,255,0.75)" : C.muted,
                          }}
                        >
                          열차 번호
                        </div>
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: isSelected ? "#fff" : C.text,
                          }}
                        >
                          {train.id}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: isSelected ? "#fff" : C.primary,
                        }}
                      >
                        {train.eta}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: `1px solid ${isSelected ? "rgba(255,255,255,0.2)" : C.border}`,
                        fontSize: 13,
                        color: isSelected ? "rgba(255,255,255,0.8)" : C.muted,
                      }}
                    >
                      현재 위치:{" "}
                      <span
                        style={{
                          fontWeight: 600,
                          color: isSelected ? "#fff" : C.text,
                        }}
                      >
                        {train.current}역
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!isLoading && trains.length === 0 ? (
            <div style={{ marginTop: 14, color: C.muted, fontSize: 14 }}>
              해당 노선의 열차 데이터가 없어요
            </div>
          ) : null}
        </div>
      </div>
      <BottomButton
        label="다음 — 호차 선택"
        onClick={() => onNext(trains.find((row) => row.id === selected) ?? null)}
        disabled={!selected}
      />
    </div>
  );
}

// ─── Step 3: 호차 + 좌석 선택 ──────────────────────────────────────
function StepSeat({
  line,
  station,
  trainId,
  lineNumber,
  mode,
  direction,
  drtnInfo,
  currentStation,
  onNext,
  onBack,
}) {
  const isLeaveMode = mode === "leave";
  const isSeoulLine = isSeoulLineFromLineProp(line);
  const requireSeatOnLeave = isLeaveMode && isSeoulLine;
  const carCount = resolveCarCountFromLineProp(line);
  const carNumbers = Array.from({ length: carCount }, (_, index) => index + 1);
  const [selectedCar, setSelectedCar] = useState(() => (isLeaveMode ? null : 1));
  const [selectedSeat, setSelectedSeat] = useState(null);

  useEffect(() => {
    if (isLeaveMode) {
      setSelectedCar((prev) => (prev != null && prev > carCount ? null : prev));
    } else {
      setSelectedCar((prev) => (prev != null && prev <= carCount ? prev : 1));
    }
    setSelectedSeat(null);
  }, [line, carCount, isLeaveMode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <Header step={3} onBack={onBack} title="호차 · 좌석 선택" line={line} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 0" }}>
        <StepDots step={3} />

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>호차 선택</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {carNumbers.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setSelectedCar(n);
                  setSelectedSeat(null);
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  border: `1.5px solid ${selectedCar === n ? C.primary : C.border}`,
                  background: selectedCar === n ? C.primary : C.card,
                  color: selectedCar === n ? "#fff" : C.text,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {selectedCar && (!isLeaveMode || isSeoulLine) ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              {selectedCar}번 호차 좌석
              {isLeaveMode ? " · 앉은 자리를 탭하세요" : ""}
            </div>
            <SubwaySeatMap
              key={`${trainId}-${selectedCar}-${mode}`}
              line={line}
              station={station || currentStation || ""}
              trainNo={trainId}
              lineNumber={lineNumber}
              direction={direction}
              drtnInfo={drtnInfo}
              car={selectedCar}
              interactionMode={isLeaveMode ? "leave" : "seek"}
              selectedSeatId={selectedSeat?.id}
              onSeatClick={(seat) => setSelectedSeat((prev) => (prev?.id === seat.id ? null : seat))}
            />
          </div>
        ) : null}

        {isLeaveMode && !isSeoulLine ? (
          <div style={{ textAlign: "center", padding: "24px 0 0", color: "#7B8794", fontSize: 13 }}>
            인천 노선은 호차 번호만 선택하면 등록할 수 있어요
          </div>
        ) : null}
      </div>
      <BottomButton
        label={
          isLeaveMode
            ? !selectedCar
              ? "호차를 먼저 선택해주세요"
              : requireSeatOnLeave && !selectedSeat
                ? "앉은 자리를 선택해주세요"
                : "하차 등록하기"
            : selectedSeat
              ? selectedSeat.status === "alighting"
                ? "이 자리 요청하기"
                : "요청 등록하기"
              : selectedCar
                ? "좌석을 선택해주세요"
                : "호차를 먼저 선택해주세요"
        }
        onClick={() => onNext({ car: selectedCar, seat: selectedSeat })}
        disabled={
          isLeaveMode
            ? !selectedCar || (requireSeatOnLeave && !selectedSeat)
            : !selectedSeat
        }
      />
    </div>
  );
}

// ─── 완료 화면 ────────────────────────────────────────────────────
function StepDone({ line, station, trainId, car, seat, mode, onReset, onGoWaiting }) {
  const isLeaveMode = mode === "leave";
  const matchedOnRegister = seat?.matched === true;
  const seatLabel =
    seat?.car && seat?.door
      ? ` · ${seat.car}-${seat.door}번 문 옆`
      : "";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", padding: 32, textAlign: "center",
      background: C.bg,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 36,
        background: C.primaryLight, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 36, marginBottom: 20,
      }}>✓</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8 }}>
        {isLeaveMode ? "하차 등록 완료!" : "등록 완료!"}
      </div>
      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 32 }}>
        {line}<br />
        열차 <strong style={{ color: C.text }}>{trainId}</strong> · <strong style={{ color: C.text }}>{car}번 호차</strong>
        {seatLabel ? <>{seatLabel}</> : null}
        <br />
        {isLeaveMode ? (
          <>
            <strong style={{ color: C.text }}>{formatStationDisplayName(station)}</strong>
            에서 하차 예정으로 등록했습니다.
            {matchedOnRegister ? (
              <>
                <br />
                <span style={{ fontSize: 13, color: C.muted }}>
                  착석 희망자와 매칭되었습니다. 상대방이 수락하면 완료됩니다.
                </span>
              </>
            ) : null}
          </>
        ) : (
          <><strong style={{ color: C.text }}>{station}역</strong> 하차 전 알림을 드릴게요</>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 280 }}>
        {!isLeaveMode && onGoWaiting ? (
          <button
            type="button"
            onClick={onGoWaiting}
            style={{
              padding: "13px 32px",
              background: C.primary,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            매칭 대기 화면으로
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: "13px 32px",
            background: isLeaveMode ? C.primary : C.card,
            color: isLeaveMode ? "#fff" : C.text,
            border: isLeaveMode ? "none" : `1px solid ${C.border}`,
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          새로 요청하기
        </button>
      </div>
    </div>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────
export default function BoardingRequest({ line = "서울 1호선 · 소요산 방면", mode = "seek" }) {
  const router = useRouter();
  const isLeaveMode = mode === "leave";
  const normalizedLine = normalizeLineLabel(line);
  const [step, setStep] = useState(1);
  const [station, setStation] = useState(null);
  const [trainId, setTrainId] = useState(null);
  const [trainDirection, setTrainDirection] = useState("하행");
  const [trainDrtnInfo, setTrainDrtnInfo] = useState("");
  const [trainCurrentStation, setTrainCurrentStation] = useState("");
  const [seatInfo, setSeatInfo] = useState(null);
  const [currentStationName, setCurrentStationName] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lineNumber = resolveLineNumberFromLineProp(normalizedLine);

  useEffect(() => {
    if (!isLeaveMode) return;
    try {
      const raw = sessionStorage.getItem("boardingDetectedLocation");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.nearestStationName === "string") {
        setCurrentStationName(parsed.nearestStationName);
      }
    } catch {
      // 캐시 파싱 실패 시 무시합니다.
    }
  }, [isLeaveMode]);

  async function submitSeekRequest(info) {
    const token = localStorage.getItem("token");
    if (!token) {
      setSubmitError("로그인이 필요합니다.");
      return;
    }
    if (!trainId || !info?.car || !info?.seat || !station) {
      setSubmitError("열차, 호차, 좌석, 하차역을 확인해 주세요.");
      return;
    }

    const layout = resolveCarLayout(normalizedLine);
    const seatApi =
      info.seat.seatSide && info.seat.seatNumber
        ? { seatSide: info.seat.seatSide, seatNumber: info.seat.seatNumber }
        : mapSeatIdToApi(info.seat.id, layout.seatsPerSection);

    if (!seatApi?.seatSide || !seatApi?.seatNumber) {
      setSubmitError("좌석 정보를 변환할 수 없습니다.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const destinationMeta = await lookupStationMeta(station, normalizedLine);
      if (!destinationMeta?.stationCode) {
        setSubmitError("하차역 정보를 찾을 수 없습니다.");
        return;
      }

      const boardingName = trainCurrentStation || currentStationName || "현재역";
      const boardingMeta =
        (await lookupStationMeta(boardingName, normalizedLine)) ?? {
          stationCode: `${resolveStationCodePrefixFromLineProp(normalizedLine)}-01`,
          stationName: boardingName,
          stationOrder: 1,
        };

      const remainingStops = resolveRemainingStops(
        boardingMeta.stationOrder,
        destinationMeta.stationOrder
      );

      const response = await fetch("/api/match-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: "seeker",
          train_id: trainId,
          line_number: lineNumber,
          direction: normalizeDirectionForStorage(trainDirection || "하행"),
          car_number: info.car,
          seat_side: seatApi.seatSide,
          seat_number: seatApi.seatNumber,
          destination_id: destinationMeta.stationCode,
          destination_name: destinationMeta.stationName || station,
          boarding_station_id: boardingMeta.stationCode,
          boarding_station_name: boardingMeta.stationName || boardingName,
          remaining_stops: remainingStops,
        }),
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        setSubmitError("서버 응답을 처리할 수 없습니다.");
        return;
      }

      if (!response.ok || payload?.success === false) {
        setSubmitError(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "착석 요청 등록에 실패했습니다."
        );
        return;
      }

      if (!payload?.data?.match_request_id) {
        setSubmitError("착석 요청 응답이 올바르지 않습니다.");
        return;
      }

      const draft = {
        role: "seeker",
        lineKey: resolveApiLineKeyFromLineProp(normalizedLine),
        lineLabel: normalizedLine,
        lineNumber,
        trainNo: trainId,
        carNumber: info.car,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        boardingStationId: boardingMeta.stationCode,
        boardingStationName: boardingMeta.stationName,
        destinationId: destinationMeta.stationCode,
        destinationName: destinationMeta.stationName || station,
        remainingStations: remainingStops,
        seatSide: seatApi.seatSide,
        seatNumber: seatApi.seatNumber,
      };

      try {
        sessionStorage.setItem("boardingDraft", JSON.stringify(draft));
        sessionStorage.setItem("waitingDraft", JSON.stringify(draft));
        sessionStorage.setItem("activeMatchRequestId", payload.data.match_request_id);
        sessionStorage.setItem("seekerMatchRequestRegistered", "true");
        if (payload.data.match_id) {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        }
      } catch {
        // sessionStorage 실패 시에도 완료 화면은 표시합니다.
      }

      if (payload.data.matched && payload.data.match_id) {
        try {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        } catch {
          // sessionStorage 실패 시 완료 화면으로 폴백합니다.
        }
        window.location.href = "/matching";
        return;
      }

      setSeatInfo(info);
      setStep(4);
    } catch {
      setSubmitError("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitLeaveRequest(info) {
    const token = localStorage.getItem("token");
    if (!token) {
      setSubmitError("로그인이 필요합니다.");
      return;
    }
    if (!trainId || !info?.car) {
      setSubmitError("열차 번호와 호차 번호를 확인해 주세요.");
      return;
    }
    if (!station?.trim()) {
      setSubmitError("내릴 역(하차역)을 선택해 주세요.");
      return;
    }

    const layout = resolveCarLayout(normalizedLine);
    const seatApi =
      info.seat?.seatSide && info.seat?.seatNumber
        ? { seatSide: info.seat.seatSide, seatNumber: info.seat.seatNumber }
        : info.seat?.id
          ? mapSeatIdToApi(info.seat.id, layout.seatsPerSection)
          : null;

    if (isSeoulLineFromLineProp(normalizedLine) && !seatApi?.seatSide) {
      setSubmitError("앉은 자리를 선택해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    try {
      const lineNumber = resolveLineNumberFromLineProp(normalizedLine);
      const destinationMeta = await lookupStationMeta(station, normalizedLine);
      if (!destinationMeta?.stationCode) {
        setSubmitError("하차역 정보를 찾을 수 없습니다.");
        return;
      }

      const boardingName = trainCurrentStation || currentStationName || "현재역";
      const boardingMeta =
        (await lookupStationMeta(boardingName, normalizedLine)) ?? {
          stationCode: `${resolveStationCodePrefixFromLineProp(normalizedLine)}-01`,
          stationName: boardingName,
          stationOrder: 1,
        };

      if (
        Number.isFinite(boardingMeta.stationOrder) &&
        Number.isFinite(destinationMeta.stationOrder) &&
        destinationMeta.stationOrder <= boardingMeta.stationOrder
      ) {
        setSubmitError("하차역은 현재 탑승 위치보다 앞쪽 역일 수 없습니다.");
        return;
      }

      const remainingStops = resolveRemainingStops(
        boardingMeta.stationOrder,
        destinationMeta.stationOrder
      );

      const body = {
        role: "provider",
        train_id: trainId,
        line_number: lineNumber,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        car_number: info.car,
        destination_id: destinationMeta.stationCode,
        destination_name: destinationMeta.stationName || station,
        remaining_stops: remainingStops,
        boarding_station_id: boardingMeta.stationCode,
        boarding_station_name: boardingMeta.stationName || boardingName,
      };
      if (seatApi?.seatSide && seatApi?.seatNumber) {
        body.seat_side = seatApi.seatSide;
        body.seat_number = seatApi.seatNumber;
      }

      const response = await fetch("/api/match-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        setSubmitError("서버 응답을 처리할 수 없습니다.");
        return;
      }
      if (!response.ok || payload?.success === false) {
        setSubmitError(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "하차 등록에 실패했습니다."
        );
        return;
      }
      if (!payload?.data?.match_request_id) {
        setSubmitError("하차 등록 응답이 올바르지 않습니다.");
        return;
      }

      const providerDraft = {
        role: "provider",
        lineLabel: normalizedLine,
        lineNumber,
        trainNo: trainId,
        carNumber: info.car,
        direction: normalizeDirectionForStorage(trainDirection || "하행"),
        destinationId: destinationMeta.stationCode,
        destinationName: destinationMeta.stationName || station,
        remainingStations: remainingStops,
        seatSide: seatApi?.seatSide,
        seatNumber: seatApi?.seatNumber,
      };
      try {
        sessionStorage.setItem("boardingDraft", JSON.stringify(providerDraft));
        sessionStorage.setItem("providerRegistered", "true");
        sessionStorage.setItem("activeMatchRequestId", payload.data.match_request_id);
        if (payload.data.match_id) {
          sessionStorage.setItem("activeMatchId", payload.data.match_id);
        }
      } catch {
        // sessionStorage 실패 시 완료 화면만 표시합니다.
      }

      setSeatInfo({ ...info, matched: Boolean(payload.data.matched) });
      setStep(4);
    } catch {
      setSubmitError("네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const reset = () => {
    setStep(1);
    setStation(null);
    setTrainId(null);
    setTrainDirection("하행");
    setTrainDrtnInfo("");
    setTrainCurrentStation("");
    setSeatInfo(null);
    setSubmitError("");
    setIsSubmitting(false);
  };

  function goToWaiting() {
    if (typeof window !== "undefined") {
      window.location.href = "/waiting";
    }
  }

  /** 첫 단계·내릴게요 열차 단계에서 뒤로가기 → 홈 */
  function exitToHome() {
    router.push("/");
  }

  function handleBackFromStep2() {
    setStep(1);
  }

  function handleBackFromStep3() {
    setStep(2);
  }

  return (
    <div style={{
      maxWidth: 390, margin: "0 auto",
      height: "100dvh", minHeight: 600,
      display: "flex", flexDirection: "column",
      fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
      background: C.card, overflow: "hidden",
      border: `1px solid ${C.border}`, borderRadius: 20,
      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    }}>
      {step === 1 && (
        <StepStation
          line={normalizedLine}
          mode={mode}
          onNext={(s) => {
            setStation(s);
            setStep(2);
          }}
          onBack={exitToHome}
        />
      )}
      {step === 2 && (
        <StepTrain
          line={normalizedLine}
          mode={mode}
          station={station}
          currentStation={isLeaveMode ? currentStationName : ""}
          onNext={(train) => {
            if (!train) return;
            setTrainId(train.id);
            setTrainDirection(train.direction || "하행");
            setTrainDrtnInfo(resolveDrtnInfoFromDirectionDisplay(train.eta));
            setTrainCurrentStation(train.current || "");
            setStep(3);
          }}
          onBack={handleBackFromStep2}
        />
      )}
      {step === 3 && (
        <StepSeat
          line={normalizedLine}
          station={station}
          trainId={trainId}
          lineNumber={lineNumber}
          mode={mode}
          direction={trainDirection}
          drtnInfo={trainDrtnInfo}
          currentStation={trainCurrentStation || currentStationName}
          onNext={(info) => {
            if (isLeaveMode) {
              void submitLeaveRequest(info);
              return;
            }
            void submitSeekRequest(info);
          }}
          onBack={handleBackFromStep3}
        />
      )}
      {isSubmitting ? (
        <p style={{ margin: "8px 16px", fontSize: 13, color: "#64748B" }}>
          {isLeaveMode ? "하차 등록 중..." : "착석 요청 등록 중..."}
        </p>
      ) : null}
      {submitError ? (
        <p style={{ margin: "8px 16px", fontSize: 13, color: "#DC2626" }}>{submitError}</p>
      ) : null}
      {step === 4 && (
        <StepDone
          line={normalizedLine}
          station={station}
          trainId={trainId}
          car={seatInfo?.car}
          seat={seatInfo?.seat}
          mode={mode}
          onReset={reset}
          onGoWaiting={isLeaveMode ? undefined : goToWaiting}
        />
      )}
    </div>
  );
}
