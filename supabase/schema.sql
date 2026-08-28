-- 路線ごとの駅一覧
create table if not exists line_stations (
  line_id text not null,
  station_id text not null,
  name text not null,
  seq integer not null,
  primary key (line_id, station_id)
);

-- 行き先別の最終電車
create table if not exists last_trains (
  id bigint generated always as identity primary key,
  line_id text not null,
  station_id text not null,
  direction text not null,
  day_type text not null,
  depart_time text not null,
  marker text not null default '',
  terminus text,
  source_url text not null,
  dia_date text,
  note text,
  fetched_at timestamptz not null default now(),
  unique (line_id, station_id, direction, day_type, depart_time, marker)
);
