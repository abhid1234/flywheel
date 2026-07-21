const BLOCKS = "▁▂▃▄▅▆▇█";
const DAY_MS = 24 * 60 * 60 * 1000;

const finiteNonnegative = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

export function sparkline(values) {
  try {
    const source = Array.isArray(values) ? values.map(finiteNonnegative) : [];
    if (!source.length) return "";
    const maximum = Math.max(...source);
    if (maximum === 0) return BLOCKS[0].repeat(source.length);
    return source.map((value) => BLOCKS[Math.round((value / maximum) * (BLOCKS.length - 1))]).join("");
  } catch { return ""; }
}

export function buildTrend(historyRows, opts = {}) {
  try {
    const rows = (Array.isArray(historyRows) ? historyRows : []).flatMap((row) => {
      const time = Date.parse(row?.ts);
      if (!Number.isFinite(time)) return [];
      return [{ ts: new Date(time).toISOString(), time, episodes: finiteNonnegative(row?.episodes), fails: finiteNonnegative(row?.fail_labels) }];
    }).sort((a, b) => a.time - b.time);

    let previous;
    const daily = new Map();
    for (const row of rows) {
      const newEpisodes = previous === undefined ? 0 : Math.max(0, row.episodes - previous);
      previous = row.episodes;
      const date = row.ts.slice(0, 10);
      const current = daily.get(date);
      daily.set(date, {
        ts: row.ts, date, episodes: row.episodes, fails: row.fails,
        failRate: row.episodes > 0 ? row.fails / row.episodes : 0,
        newEpisodes: (current?.newEpisodes ?? 0) + newEpisodes,
      });
    }
    const points = [...daily.values()];
    const first = rows[0];
    const last = rows.at(-1);
    const meanFailRate = points.length ? points.reduce((sum, point) => sum + point.failRate, 0) / points.length : 0;
    const summary = {
      firstTs: first?.ts ?? null,
      lastTs: last?.ts ?? null,
      spanDays: first && last ? (last.time - first.time) / DAY_MS : 0,
      totalEpisodes: last?.episodes ?? 0,
      netNewEpisodes: first && last ? Math.max(0, last.episodes - first.episodes) : 0,
      meanFailRate,
      sparkline: sparkline(points.map((point) => point.newEpisodes)),
    };
    return { points, summary };
  } catch {
    return { points: [], summary: { firstTs: null, lastTs: null, spanDays: 0, totalEpisodes: 0, netNewEpisodes: 0, meanFailRate: 0, sparkline: "" } };
  }
}
