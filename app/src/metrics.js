'use strict';

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function labelsKey(labels) {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',');
}

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const inner = keys
    .sort()
    .map((key) => `${key}="${escapeLabelValue(labels[key])}"`)
    .join(',');
  return `{${inner}}`;
}

function createMetrics({ app = 'reservations-api', buckets = DEFAULT_BUCKETS } = {}) {
  const counters = new Map();
  const histograms = new Map();
  const startedAt = Date.now();

  function inc(name, labels = {}, amount = 1) {
    const key = `${name}|${labelsKey(labels)}`;
    const current = counters.get(key);
    if (current) {
      current.value += amount;
      return current.value;
    }
    counters.set(key, { name, labels: { ...labels }, value: amount });
    return amount;
  }

  function observe(name, labels = {}, seconds = 0) {
    const key = `${name}|${labelsKey(labels)}`;
    let hist = histograms.get(key);
    if (!hist) {
      hist = {
        name,
        labels: { ...labels },
        buckets: buckets.map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      };
      histograms.set(key, hist);
    }
    hist.sum += seconds;
    hist.count += 1;
    for (const bucket of hist.buckets) {
      if (seconds <= bucket.le) bucket.count += 1;
    }
    return hist;
  }

  function request(method, path, code, seconds) {
    const labels = { app, method, path, code: String(code) };
    inc('http_requests_total', labels);
    observe('http_request_duration_seconds', { app, method, path }, seconds);
  }

  function render() {
    const lines = [];
    lines.push('# HELP app_info Build and environment information.');
    lines.push('# TYPE app_info gauge');
    lines.push(`app_info{app="${escapeLabelValue(app)}"} 1`);

    lines.push('# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.');
    lines.push('# TYPE process_start_time_seconds gauge');
    lines.push(`process_start_time_seconds ${startedAt / 1000}`);

    const counterNames = new Set([...counters.values()].map((c) => c.name));
    for (const name of [...counterNames].sort()) {
      lines.push(`# HELP ${name} Counter.`);
      lines.push(`# TYPE ${name} counter`);
      for (const entry of [...counters.values()].filter((c) => c.name === name)) {
        lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
      }
    }

    const histNames = new Set([...histograms.values()].map((h) => h.name));
    for (const name of [...histNames].sort()) {
      lines.push(`# HELP ${name} Histogram.`);
      lines.push(`# TYPE ${name} histogram`);
      for (const hist of [...histograms.values()].filter((h) => h.name === name)) {
        let cumulative = 0;
        for (const bucket of hist.buckets) {
          cumulative = bucket.count;
          lines.push(`${name}_bucket${formatLabels({ ...hist.labels, le: String(bucket.le) })} ${cumulative}`);
        }
        lines.push(`${name}_bucket${formatLabels({ ...hist.labels, le: '+Inf' })} ${hist.count}`);
        lines.push(`${name}_sum${formatLabels(hist.labels)} ${hist.sum}`);
        lines.push(`${name}_count${formatLabels(hist.labels)} ${hist.count}`);
      }
    }

    return `${lines.join('\n')}\n`;
  }

  function snapshot() {
    return {
      counters: [...counters.values()].map((c) => ({ ...c, labels: { ...c.labels } })),
      histograms: [...histograms.values()].map((h) => ({
        name: h.name,
        labels: { ...h.labels },
        count: h.count,
        sum: h.sum,
      })),
    };
  }

  return { inc, observe, request, render, snapshot, buckets };
}

module.exports = { createMetrics, DEFAULT_BUCKETS, formatLabels, labelsKey };
