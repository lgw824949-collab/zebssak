-- 서울 7호선 연장: 신중동~부천시청 순서 정정, 상동 이후 삼산체육관~석남 추가

INSERT INTO public.stations (station_code, station_name, line_number, station_order)
VALUES
  ('s7-46', '신중동', 2, 46),
  ('s7-47', '부천시청', 2, 47),
  ('s7-48', '상동', 2, 48),
  ('s7-49', '삼산체육관', 2, 49),
  ('s7-50', '굴포천', 2, 50),
  ('s7-51', '부평구청', 2, 51),
  ('s7-52', '산곡', 2, 52),
  ('s7-53', '석남', 2, 53)
ON CONFLICT (station_code) DO UPDATE
SET
  station_name = EXCLUDED.station_name,
  line_number = EXCLUDED.line_number,
  station_order = EXCLUDED.station_order;
