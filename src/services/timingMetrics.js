const MAX_SAMPLES = 300;

const state = {
  db: {
    count: 0,
    failCount: 0,
    totalMs: 0,
    samples: [],
    last: null
  },
  operations: {}
};

function pushSample(arr, value) {
  arr.push(value);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

function recordDbTiming({ commandName, databaseName, durationMs, ok, error }) {
  if (!Number.isFinite(durationMs)) return;

  state.db.count += 1;
  state.db.totalMs += durationMs;
  if (!ok) state.db.failCount += 1;
  pushSample(state.db.samples, durationMs);

  state.db.last = {
    commandName,
    databaseName,
    durationMs,
    ok,
    error: error || null,
    at: new Date()
  };
}

function recordOperationTiming(name, totalMs, dbMs = 0, meta = {}) {
  if (!name || !Number.isFinite(totalMs)) return;

  if (!state.operations[name]) {
    state.operations[name] = {
      count: 0,
      totalMs: 0,
      dbTotalMs: 0,
      samples: [],
      last: null
    };
  }

  const entry = state.operations[name];
  entry.count += 1;
  entry.totalMs += totalMs;
  entry.dbTotalMs += Number.isFinite(dbMs) ? dbMs : 0;
  pushSample(entry.samples, totalMs);

  entry.last = {
    totalMs,
    dbMs: Number.isFinite(dbMs) ? dbMs : 0,
    appMs: Math.max(totalMs - (Number.isFinite(dbMs) ? dbMs : 0), 0),
    at: new Date(),
    meta
  };
}

function buildOperationSnapshot() {
  const out = {};
  for (const [name, entry] of Object.entries(state.operations)) {
    const avgMs = entry.count ? entry.totalMs / entry.count : 0;
    out[name] = {
      count: entry.count,
      avgMs: Number(avgMs.toFixed(2)),
      p95Ms: Number(percentile(entry.samples, 95).toFixed(2)),
      last: entry.last
    };
  }
  return out;
}

function getTimingSnapshot() {
  const dbAvg = state.db.count ? state.db.totalMs / state.db.count : 0;

  return {
    generatedAt: new Date(),
    db: {
      count: state.db.count,
      failCount: state.db.failCount,
      avgMs: Number(dbAvg.toFixed(2)),
      p95Ms: Number(percentile(state.db.samples, 95).toFixed(2)),
      last: state.db.last
    },
    operations: buildOperationSnapshot()
  };
}

module.exports = {
  recordDbTiming,
  recordOperationTiming,
  getTimingSnapshot
};
