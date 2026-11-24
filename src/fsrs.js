/*
 * FSRS-6 memory model + Anki's card state machine.
 * Ported from fsrs-rs 6.6.2 (model.rs, inference.rs) and Anki 26.09
 * rslib/src/scheduler/states/*.rs (learning, review, relearning, fuzz, steps).
 * Pure functions only: no DOM, no storage. Works in browser and Node.
 */
(function (root) {
  'use strict';

  const DEFAULT_W = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
    0.0912, 0.0658, 0.1542,
  ];
  const LOWER = [0.001, 0.001, 0.001, 0.001, 1, 0.001, 0.001, 0.001, 0, 0, 0.001, 0.001, 0.001, 0.001, 0, 0, 1, 0, 0, 0, 0.1];
  const UPPER = [100, 100, 100, 100, 10, 4, 4, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2, 0.8, 0.8];
  const S_MIN = 0.001, S_MAX = 36500, D_MIN = 1, D_MAX = 10;
  const DAY = 86400;

  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

  function validParams(w) {
    if (!Array.isArray(w) || w.length !== 21) return false;
    return w.every((v, i) => Number.isFinite(v) && v >= LOWER[i] - 1e-9 && v <= UPPER[i] + 1e-9);
  }

  // ---------- FSRS-6 model (fsrs-rs model.rs) ----------
  function factorOf(w) { const decay = -w[20]; return Math.pow(0.9, 1 / decay) - 1; }
  function retrievability(w, t, s) {
    const decay = -w[20];
    return Math.pow(1 + factorOf(w) * t / s, decay);
  }
  const f32 = Math.fround; // Anki computes in f32; emulate to get identical rounding
  function nextIntervalRaw(w, s, desiredRetention) {
    const decay = f32(-w[20]);
    const factor = f32(Math.pow(0.9, f32(1 / decay)) - 1);
    return f32(f32(f32(s) / factor) * f32(Math.pow(f32(desiredRetention), f32(1 / decay)) - 1));
  }
  function initStability(w, g) { return w[clamp(g, 1, 4) - 1]; }
  function initDifficulty(w, g) { return w[4] - Math.exp(w[5] * (g - 1)) + 1; }
  function nextDifficulty(w, d, g) {
    const deltaD = -w[6] * (g - 3);
    let nd = d + (10 - d) * deltaD / 9; // linear damping
    nd = w[7] * (initDifficulty(w, 4) - nd) + nd; // mean reversion
    return clamp(nd, D_MIN, D_MAX);
  }
  function stabilityAfterSuccess(w, s, d, r, g) {
    const hard = g === 2 ? w[15] : 1;
    const easy = g === 4 ? w[16] : 1;
    return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy + 1);
  }
  function stabilityAfterFailure(w, s, d, r) {
    const newS = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
    const newSMin = s / Math.exp(w[17] * w[18]);
    return Math.min(newS, newSMin);
  }
  function stabilityShortTerm(w, s, g) {
    const sinc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
    return s * (g >= 2 ? Math.max(sinc, 1) : sinc);
  }
  /** One review step. mem = {s, d} or null for a brand new card. */
  function step(w, deltaT, g, mem) {
    if (!mem) {
      return { s: f32(clamp(initStability(w, g), S_MIN, S_MAX)), d: f32(clamp(initDifficulty(w, g), D_MIN, D_MAX)) };
    }
    const s = clamp(mem.s, S_MIN, S_MAX);
    const d = clamp(mem.d, D_MIN, D_MAX);
    const r = retrievability(w, deltaT, s);
    let ns;
    if (deltaT === 0) ns = stabilityShortTerm(w, s, g);
    else if (g === 1) ns = stabilityAfterFailure(w, s, d, r);
    else ns = stabilityAfterSuccess(w, s, d, r, g);
    return { s: f32(clamp(ns, S_MIN, S_MAX)), d: f32(nextDifficulty(w, d, g)) };
  }
  /** fsrs-rs next_states: memory state + unrounded interval (days) for each rating. */
  function nextStates(w, mem, desiredRetention, daysElapsed) {
    const out = {};
    ['again', 'hard', 'good', 'easy'].forEach((k, i) => {
      const m = step(w, daysElapsed, i + 1, mem);
      out[k] = { mem: m, interval: nextIntervalRaw(w, m.s, desiredRetention) };
    });
    return out;
  }
  /** fsrs-rs memory_state_from_sm2 (used for imported cards that only have SM-2 data). */
  function memoryFromSm2(w, easeFactor, interval, sm2Retention) {
    sm2Retention = sm2Retention || 0.9;
    const decay = -w[20];
    const factor = Math.pow(0.9, 1 / decay) - 1;
    const s = Math.max(interval, S_MIN) * factor / (Math.pow(sm2Retention, 1 / decay) - 1);
    const d = 11 - (easeFactor - 1) / (Math.exp(w[8]) * Math.pow(s, -w[9]) * Math.expm1((1 - sm2Retention) * w[10]));
    if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
    return { s: clamp(s, S_MIN, S_MAX), d: clamp(d, D_MIN, D_MAX) };
  }

  // ---------- deterministic randomness (replaces Anki's seeded StdRng) ----------
  function hash32(n) {
    // mix a (possibly > 2^32) integer into 32 bits
    let h = 0x811c9dc5;
    const str = String(n);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hash32(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Fuzz seed is card id + reps, exactly like Anki, so button labels match the applied result. */
  function fuzzSeed(cardId, reps) { return cardId + '_' + reps; }
  function fuzzFactor(seed) { return seed == null ? null : rng(seed)(); }

  // ---------- fuzz (states/fuzz.rs) ----------
  const FUZZ_RANGES = [
    { start: 2.5, end: 7.0, factor: 0.15 },
    { start: 7.0, end: 20.0, factor: 0.1 },
    { start: 20.0, end: Infinity, factor: 0.05 },
  ];
  function fuzzDelta(interval) {
    if (interval < 2.5) return 0;
    let delta = 1.0;
    for (const r of FUZZ_RANGES) delta += r.factor * Math.max(Math.min(interval, r.end) - r.start, 0);
    return delta;
  }
  const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x)); // Rust f32::round
  const toU32 = (x) => Math.max(0, roundHalfAway(x)); // Rust `as u32` saturates at 0
  function fuzzBounds(interval) {
    const delta = fuzzDelta(interval);
    return [toU32(interval - delta), toU32(interval + delta)];
  }
  function constrainedFuzzBounds(interval, minimum, maximum) {
    minimum = Math.min(minimum, maximum);
    interval = clamp(interval, minimum, maximum);
    let [lower, upper] = fuzzBounds(interval);
    lower = clamp(lower, minimum, maximum);
    upper = clamp(upper, minimum, maximum);
    if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
    return [lower, upper];
  }
  function withReviewFuzzPlain(factor, interval, minimum, maximum) {
    if (factor != null) {
      const [lower, upper] = constrainedFuzzBounds(interval, minimum, maximum);
      return Math.floor(lower + factor * (1 + upper - lower));
    }
    return clamp(toU32(interval), minimum, maximum);
  }
  function withReviewFuzz(ctx, interval, minimum, maximum) {
    if (ctx.loadBalancer) {
      const v = ctx.loadBalancer(interval, minimum, maximum);
      if (v != null) return v;
    }
    return withReviewFuzzPlain(ctx.fuzzFactor, interval, minimum, maximum);
  }
  function minimumReviewFuzzInterval(interval, previous, maximum) {
    const rounded = toU32(interval);
    const upper = constrainedFuzzBounds(interval, 1, maximum)[1];
    if (rounded > previous) return previous + 1;
    if (previous <= upper) return previous;
    return 0;
  }
  function minMax(ctx, minimum) {
    const maximum = Math.max(ctx.maxIvl, 1);
    return [clamp(minimum, 1, maximum), maximum];
  }

  // ---------- learning steps (states/steps.rs) ----------
  const toSecs = (mins) => Math.trunc(mins * 60);
  function maybeRoundInDays(secs) { return secs > DAY ? Math.round(secs / DAY) * DAY : secs; }
  function Steps(steps) {
    steps = steps || [];
    const getIndex = (remaining) => Math.min(Math.max(steps.length - (remaining % 1000), 0), Math.max(steps.length - 1, 0));
    const at = (i) => (i >= 0 && i < steps.length ? toSecs(steps[i]) : null);
    return {
      isEmpty: () => steps.length === 0,
      againDelay: () => at(0),
      hardDelay(remaining) {
        const idx = getIndex(remaining);
        let current = at(idx);
        if (current == null) current = steps.length ? toSecs(steps[0]) : null;
        if (current == null) return null;
        if (idx === 0) {
          const next = at(1);
          if (next != null) return maybeRoundInDays(Math.floor((current + next) / 2));
          return maybeRoundInDays(Math.min(Math.floor(current * 3 / 2), current + DAY));
        }
        return current;
      },
      goodDelay(remaining) { return at(getIndex(remaining) + 1); },
      currentDelay(remaining) { const v = at(getIndex(remaining)); return v == null ? 0 : v; },
      remainingForGood(remaining) { return Math.max(steps.length - (getIndex(remaining) + 1), 0); },
      remainingForFailed() { return steps.length; },
    };
  }

  // ---------- state machine (states/learning.rs, review.rs, relearning.rs) ----------
  // ctx = { fsrs: nextStates(...), fuzzFactor, loadBalancer, steps: Steps, relearnSteps: Steps,
  //         maxIvl, leechThreshold, allowShortTerm, shortTermWithSteps }
  function shortTermOk(ctx, steps, interval) {
    return ctx.allowShortTerm && (ctx.shortTermWithSteps || steps.isEmpty()) && interval < 0.5;
  }
  function learnAnswerAgain(st, ctx) {
    const mem = ctx.fsrs.again.mem;
    const delay = ctx.steps.againDelay();
    if (delay != null) return { kind: 'learn', remaining: ctx.steps.remainingForFailed(), secs: delay, mem };
    const [minimum, maximum] = minMax(ctx, 1);
    const interval = ctx.fsrs.again.interval;
    if (shortTermOk(ctx, ctx.steps, interval)) return { kind: 'learn', remaining: ctx.steps.remainingForFailed(), secs: Math.trunc(f32(interval * DAY)), mem };
    return review(withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), 0, 0, false, mem);
  }
  function learnAnswerHard(st, ctx) {
    const mem = ctx.fsrs.hard.mem;
    const delay = ctx.steps.hardDelay(st.remaining);
    if (delay != null) return { kind: 'learn', remaining: st.remaining, secs: delay, mem };
    const [minimum, maximum] = minMax(ctx, 1);
    const interval = ctx.fsrs.hard.interval;
    if (shortTermOk(ctx, ctx.steps, interval)) return { kind: 'learn', remaining: st.remaining, secs: Math.trunc(f32(interval * DAY)), mem };
    return review(withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), 0, 0, false, mem);
  }
  function learnAnswerGood(st, ctx) {
    const mem = ctx.fsrs.good.mem;
    const delay = ctx.steps.goodDelay(st.remaining);
    if (delay != null) return { kind: 'learn', remaining: ctx.steps.remainingForGood(st.remaining), secs: delay, mem };
    const [minimum, maximum] = minMax(ctx, 1);
    const interval = ctx.fsrs.good.interval;
    if (shortTermOk(ctx, ctx.steps, interval)) return { kind: 'learn', remaining: st.remaining, secs: Math.trunc(f32(interval * DAY)), mem };
    return review(withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), 0, 0, false, mem);
  }
  function learnAnswerEasy(st, ctx) {
    let [minimum, maximum] = minMax(ctx, 1);
    const good = withReviewFuzz(ctx, ctx.fsrs.good.interval, minimum, maximum);
    minimum = good + 1;
    const interval = Math.max(roundHalfAway(ctx.fsrs.easy.interval), 1);
    return review(withReviewFuzz(ctx, interval, minimum, maximum), 0, 0, false, ctx.fsrs.easy.mem);
  }
  function review(scheduledDays, elapsedDays, lapses, leeched, mem) {
    return { kind: 'review', scheduledDays, elapsedDays, lapses, leeched, mem };
  }
  function leechThresholdMet(lapses, threshold) {
    if (threshold > 0) {
      const half = Math.max(Math.ceil(threshold / 2), 1);
      return lapses >= threshold && (lapses - threshold) % half === 0;
    }
    return false;
  }
  function constrainPassing(ctx, interval, minimum) {
    const [mn, mx] = minMax(ctx, minimum);
    return withReviewFuzz(ctx, interval, mn, mx);
  }
  function reviewNextStates(st, ctx) {
    const f = ctx.fsrs;
    const hard = constrainPassing(ctx, f.hard.interval, Math.max(minimumReviewFuzzInterval(f.hard.interval, st.scheduledDays, ctx.maxIvl), 1));
    const good = constrainPassing(ctx, f.good.interval, Math.max(minimumReviewFuzzInterval(f.good.interval, st.scheduledDays, ctx.maxIvl), hard + 1));
    const easy = constrainPassing(ctx, f.easy.interval, Math.max(minimumReviewFuzzInterval(f.easy.interval, st.scheduledDays, ctx.maxIvl), good + 1));
    // again
    const lapses = st.lapses + 1;
    const leeched = leechThresholdMet(lapses, ctx.leechThreshold);
    const failDays = f.again.interval;
    const mem = f.again.mem;
    const againReview = review(Math.max(roundHalfAway(failDays), 1), 0, lapses, leeched, mem);
    let again;
    const relDelay = ctx.relearnSteps.againDelay();
    if (relDelay != null) {
      again = { kind: 'relearn', learning: { kind: 'learn', remaining: ctx.relearnSteps.remainingForFailed(), secs: relDelay, mem }, review: againReview };
    } else if (shortTermOk(ctx, ctx.relearnSteps, failDays)) {
      again = { kind: 'relearn', learning: { kind: 'learn', remaining: ctx.relearnSteps.remainingForFailed(), secs: Math.trunc(f32(failDays * DAY)), mem }, review: againReview };
    } else {
      again = againReview;
    }
    return {
      again,
      hard: review(hard, 0, st.lapses, false, f.hard.mem),
      good: review(good, 0, st.lapses, false, f.good.mem),
      easy: review(easy, 0, st.lapses, false, f.easy.mem),
    };
  }
  function relearnNextStates(st, ctx) {
    const f = ctx.fsrs;
    const rs = ctx.relearnSteps;
    const L = st.learning, R = st.review;
    const out = {};
    // again
    {
      const mem = f.again.mem;
      const delay = rs.againDelay();
      if (delay != null) {
        out.again = { kind: 'relearn', learning: { kind: 'learn', remaining: rs.remainingForFailed(), secs: delay, mem }, review: Object.assign({}, R, { scheduledDays: Math.max(roundHalfAway(f.again.interval), 1), elapsedDays: 0, mem }) };
      } else {
        const [minimum, maximum] = minMax(ctx, 1);
        const interval = f.again.interval;
        const againReview = Object.assign({}, R, { scheduledDays: withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), mem });
        out.again = shortTermOk(ctx, rs, interval)
          ? { kind: 'relearn', learning: { kind: 'learn', remaining: rs.remainingForFailed(), secs: Math.trunc(f32(interval * DAY)), mem }, review: againReview }
          : againReview;
      }
    }
    // hard
    {
      const mem = f.hard.mem;
      const delay = rs.hardDelay(L.remaining);
      if (delay != null) {
        out.hard = { kind: 'relearn', learning: Object.assign({}, L, { secs: delay, mem }), review: Object.assign({}, R, { elapsedDays: 0, mem }) };
      } else {
        const [minimum, maximum] = minMax(ctx, 1);
        const interval = f.hard.interval;
        const hardReview = Object.assign({}, R, { scheduledDays: withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), mem });
        out.hard = shortTermOk(ctx, rs, interval)
          ? { kind: 'relearn', learning: Object.assign({}, L, { secs: Math.trunc(f32(interval * DAY)), mem }), review: hardReview }
          : hardReview;
      }
    }
    // good
    {
      const mem = f.good.mem;
      const delay = rs.goodDelay(L.remaining);
      if (delay != null) {
        out.good = { kind: 'relearn', learning: { kind: 'learn', secs: delay, remaining: rs.remainingForGood(L.remaining), mem }, review: Object.assign({}, R, { elapsedDays: 0, mem }) };
      } else {
        const [minimum, maximum] = minMax(ctx, 1);
        const interval = f.good.interval;
        const goodReview = Object.assign({}, R, { scheduledDays: withReviewFuzz(ctx, Math.max(roundHalfAway(interval), 1), minimum, maximum), mem });
        out.good = shortTermOk(ctx, rs, interval)
          ? { kind: 'relearn', learning: Object.assign({}, L, { secs: Math.trunc(f32(interval * DAY)), remaining: rs.remainingForGood(L.remaining), mem }), review: goodReview }
          : goodReview;
      }
    }
    // easy
    {
      let [minimum, maximum] = minMax(ctx, 1);
      const good = withReviewFuzz(ctx, f.good.interval, minimum, maximum);
      minimum = good + 1;
      const days = withReviewFuzz(ctx, Math.max(roundHalfAway(f.easy.interval), 1), minimum, maximum);
      out.easy = Object.assign({}, R, { scheduledDays: days, elapsedDays: 0, mem: f.easy.mem });
    }
    return out;
  }
  function learnNextStates(st, ctx) {
    return { again: learnAnswerAgain(st, ctx), hard: learnAnswerHard(st, ctx), good: learnAnswerGood(st, ctx), easy: learnAnswerEasy(st, ctx) };
  }
  /** Build the "current state" for a card (answering/current.rs, normal decks only). */
  function currentState(card, today, steps, relearnSteps) {
    switch (card.type) {
      case 0: return { kind: 'new', position: Math.max(card.due, 0) };
      case 1: return { kind: 'learn', remaining: card.left, secs: steps.currentDelay(card.left), mem: card.mem };
      case 2: {
        const due = Math.min(card.due, today);
        return review(card.ivl, Math.max(card.ivl - (due - today), 0), card.lapses, false, card.mem);
      }
      case 3: return {
        kind: 'relearn',
        learning: { kind: 'learn', remaining: card.left, secs: relearnSteps.currentDelay(card.left), mem: card.mem },
        review: review(card.ivl, card.ivl, card.lapses, false, card.mem),
      };
      default: throw new Error('bad card type ' + card.type);
    }
  }
  function nextStatesForCurrent(cur, ctx) {
    switch (cur.kind) {
      case 'new': return learnNextStates({ kind: 'learn', remaining: ctx.steps.remainingForFailed(), secs: 0, mem: null }, ctx);
      case 'learn': return learnNextStates(cur, ctx);
      case 'review': return reviewNextStates(cur, ctx);
      case 'relearn': return relearnNextStates(cur, ctx);
    }
    throw new Error('bad state');
  }
  /** interval_kind().maybe_as_days(): returns {secs} or {days} */
  function intervalKind(state, secsUntilRollover) {
    let secs = null, days = null;
    if (state.kind === 'learn') secs = state.secs;
    else if (state.kind === 'relearn') secs = state.learning.secs;
    else if (state.kind === 'review') days = state.scheduledDays;
    else if (state.kind === 'new') secs = 0;
    if (secs != null) {
      if (secs >= secsUntilRollover) return { days: Math.floor((secs - secsUntilRollover) / DAY) + 1 };
      return { secs };
    }
    return { days };
  }
  /** Learning step fuzz: up to +25%, capped at 5 minutes (answering/learning.rs). */
  function learningIvlWithFuzz(seed, secs) {
    if (seed == null) return secs;
    const upperExclusive = secs + Math.floor(Math.min(secs * 0.25, 300));
    if (secs >= upperExclusive) return secs;
    const r = rng('L' + seed)();
    return secs + Math.floor(r * (upperExclusive - secs));
  }

  const api = {
    DEFAULT_W, LOWER, UPPER, S_MIN, S_MAX, D_MIN, D_MAX,
    validParams, retrievability, nextIntervalRaw, initStability, initDifficulty, nextDifficulty,
    stabilityAfterSuccess, stabilityAfterFailure, stabilityShortTerm, step, nextStates, memoryFromSm2,
    rng, hash32, fuzzSeed, fuzzFactor, fuzzBounds, constrainedFuzzBounds, withReviewFuzzPlain,
    Steps, currentState, nextStatesForCurrent, intervalKind, learningIvlWithFuzz, leechThresholdMet,
    roundHalfAway,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FSRS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
