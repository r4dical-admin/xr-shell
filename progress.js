'use strict';

(function expose(factory) {
  const runtime = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
  if (typeof window !== 'undefined') window.XR_PROGRESS = runtime;
})(() => {
  const JOB_ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;
  const VIEWS = ['remaining', 'eta', 'metrics'];

  function requireJobId(value) {
    if (!JOB_ID.test(String(value || ''))) throw new Error('jobId must be 1–64 letters, digits, _, ., : or -, starting with a letter or _');
    return String(value);
  }

  function count(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
    return value;
  }

  function metricValues(value) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) throw new Error('metrics must be an object with at most 16 entries');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) throw new Error(`Invalid metric: ${key}`);
      result[key] = typeof item === 'string' ? item.slice(0, 120) : item;
    }
    return result;
  }

  function createStore() { return new Map(); }

  function prepare(store, params = {}, now = Date.now()) {
    const jobId = requireJobId(params.jobId);
    const view = params.view || 'remaining';
    if (!VIEWS.includes(view)) throw new Error('Unsupported progress view');
    let job = store.get(jobId);
    if (!job) {
      job = { jobId, title: String(params.title || jobId).slice(0, 100), view, status: 'waiting', total: null, completed: 0, metrics: {}, runNumber: 0, startedAt: null, updatedAt: now, finishedAt: null, message: '' };
      store.set(jobId, job);
    } else {
      if (params.title) job.title = String(params.title).slice(0, 100);
      if (params.view) job.view = view;
    }
    return snapshot(job, now);
  }

  function configure(store, params = {}, now = Date.now()) {
    const job = store.get(requireJobId(params.jobId));
    if (!job) throw new Error('Progress job is not prepared');
    if (!VIEWS.includes(params.view)) throw new Error('Unsupported progress view');
    job.view = params.view;
    return snapshot(job, now);
  }

  function report(store, operation, params = {}, now = Date.now()) {
    const job = store.get(requireJobId(params.jobId));
    if (!job) throw new Error('Progress job is not prepared; ask the agent to create its widget first');
    if (operation === 'start') {
      if (job.status === 'running') throw new Error('Progress job is already running');
      job.total = count(params.total, 'total');
      job.completed = 0;
      job.metrics = metricValues(params.metrics);
      job.status = 'running';
      job.runNumber += 1;
      job.startedAt = now;
      job.finishedAt = null;
      job.message = '';
    } else if (operation === 'update') {
      if (job.status !== 'running') throw new Error('Progress job is not running');
      if (params.total !== undefined) job.total = count(params.total, 'total');
      job.completed = count(params.completed, 'completed');
      job.metrics = { ...job.metrics, ...metricValues(params.metrics) };
    } else if (operation === 'finish') {
      if (job.status !== 'running') throw new Error('Progress job is not running');
      if (!['success', 'failure'].includes(params.status)) throw new Error('finish status must be success or failure');
      job.status = params.status === 'success' ? 'succeeded' : 'failed';
      if (params.status === 'success' && job.total !== null) job.completed = Math.max(job.completed, job.total);
      job.finishedAt = now;
      job.message = String(params.message || '').slice(0, 240);
      job.metrics = { ...job.metrics, ...metricValues(params.metrics) };
    } else throw new Error('Unsupported progress operation');
    job.updatedAt = now;
    return snapshot(job, now);
  }

  function snapshot(job, now = Date.now()) {
    if (!job) return null;
    const remaining = job.total === null ? null : Math.max(0, job.total - job.completed);
    const elapsedSeconds = job.startedAt === null ? null : Math.max(0, Math.floor(((job.finishedAt ?? now) - job.startedAt) / 1000));
    const etaSeconds = job.status === 'running' && job.completed > 0 && remaining !== null
      ? Math.ceil((now - job.startedAt) / 1000 / job.completed * remaining) : null;
    return { ...job, metrics: { ...job.metrics }, remaining, elapsedSeconds, etaSeconds,
      percent: job.total ? Math.min(100, Math.round(job.completed / job.total * 100)) : 0 };
  }

  function duration(seconds) {
    if (seconds === null) return 'Calculating…';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function presentation(job) {
    const progress = job.total === null ? 'Waiting for script' : `${job.completed} / ${job.total} completed`;
    const metrics = Object.entries(job.metrics).map(([key, value]) => `${key}: ${value}`).join(' · ');
    const headline = job.status === 'waiting' ? 'Waiting for script'
      : job.view === 'eta' ? (job.status === 'running' ? `~${duration(job.etaSeconds)} left` : job.status === 'succeeded' ? 'Finished' : 'Failed')
      : job.view === 'metrics' ? (metrics || 'No metrics yet')
      : `${job.remaining ?? 0} ${job.remaining === 1 ? 'run' : 'runs'} remaining`;
    return { headline, progress, status: job.status.toUpperCase(), detail: job.message || metrics || (job.elapsedSeconds === null ? '' : `${duration(job.elapsedSeconds)} elapsed`), completed: job.completed, total: job.total || 0, view: job.view };
  }

  return { VIEWS, createStore, requireJobId, prepare, configure, report, snapshot, presentation };
});
