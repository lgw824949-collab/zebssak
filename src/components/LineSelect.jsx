"use client";

import { useMemo, useState } from "react";

const LINE_OPTIONS = [
  { key: "seoul1", label: "서울 1호선", color: "#0052A4" },
  { key: "seoul2", label: "서울 2호선", color: "#00A84D" },
  { key: "seoul3", label: "서울 3호선", color: "#EF7C1C" },
  { key: "seoul4", label: "서울 4호선", color: "#00A5DE" },
  { key: "seoul5", label: "서울 5호선", color: "#996CAC" },
  { key: "seoul6", label: "서울 6호선", color: "#CD7C2F" },
  { key: "seoul7", label: "서울 7호선", color: "#747F00" },
  { key: "seoul8", label: "서울 8호선", color: "#E6186C" },
  { key: "seoul9", label: "서울 9호선", color: "#BDB092" },
  { key: "incheon1", label: "인천 1호선", color: "#7CA8D5" },
  { key: "incheon2", label: "인천 2호선", color: "#F5A200" },
];

const DIRECTION_OPTIONS = {
  seoul1: ["소요산 방면", "인천 방면"],
  seoul2: ["내선", "외선"],
  seoul3: ["대화 방면", "오금 방면"],
  seoul4: ["진접 방면", "오이도 방면"],
  seoul5: ["방화 방면", "하남검단산 방면"],
  seoul6: ["응암 방면", "신내 방면"],
  seoul7: ["장암 방면", "석남 방면"],
  seoul8: ["암사 방면", "모란 방면"],
  seoul9: ["개화 방면", "중앙보훈병원 방면"],
  incheon1: ["계양 방면", "송도달빛축제공원 방면"],
  incheon2: ["검단오류 방면", "운연 방면"],
};

export default function LineSelect({ onCancel, onComplete }) {
  const [selectedLineKey, setSelectedLineKey] = useState(null);
  const [selectedDirection, setSelectedDirection] = useState(null);

  const selectedLine = useMemo(
    () => LINE_OPTIONS.find((line) => line.key === selectedLineKey) ?? null,
    [selectedLineKey]
  );

  const directionOptions = selectedLineKey ? DIRECTION_OPTIONS[selectedLineKey] ?? [] : [];

  function handleLineSelect(lineKey) {
    setSelectedLineKey(lineKey);
    setSelectedDirection(null);
  }

  function handleDirectionSelect(direction) {
    setSelectedDirection(direction);
  }

  function handleNext() {
    if (!selectedLine || !selectedDirection) return;
    onComplete({
      lineKey: selectedLine.key,
      lineLabel: selectedLine.label,
      direction: selectedDirection,
    });
  }

  return (
    <div className="rounded-2xl border border-[#E6E8EB] bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#1A1A1A]">노선 선택</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[#D8DCE2] px-3 py-1.5 text-sm font-bold text-[#5B6472]"
        >
          닫기
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {LINE_OPTIONS.map((line) => {
          const selected = selectedLineKey === line.key;
          return (
            <button
              key={line.key}
              type="button"
              onClick={() => handleLineSelect(line.key)}
              className="rounded-xl border px-3 py-2 text-left text-sm font-bold transition"
              style={{
                borderColor: selected ? line.color : "#E6E8EB",
                background: selected ? `${line.color}14` : "#FFFFFF",
                color: "#1A1A1A",
              }}
            >
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ background: line.color }}
              />
              {line.label}
            </button>
          );
        })}
      </div>

      {selectedLine ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-extrabold text-[#1A1A1A]">방향 선택</h3>
          <div className="flex flex-wrap gap-2">
            {directionOptions.map((direction) => {
              const selected = selectedDirection === direction;
              return (
                <button
                  key={direction}
                  type="button"
                  onClick={() => handleDirectionSelect(direction)}
                  className="rounded-full border px-3 py-2 text-sm font-bold transition"
                  style={{
                    borderColor: selected ? selectedLine.color : "#D8DCE2",
                    background: selected ? selectedLine.color : "#FFFFFF",
                    color: selected ? "#FFFFFF" : "#1A1A1A",
                  }}
                >
                  {direction}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleNext}
        disabled={!selectedLine || !selectedDirection}
        className="mt-5 w-full rounded-xl bg-[#0B1F4B] py-3 text-base font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        선택 완료
      </button>
    </div>
  );
}
