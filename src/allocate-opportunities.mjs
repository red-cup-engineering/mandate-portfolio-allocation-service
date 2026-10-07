/**
 * Venue-neutral sizing of discrete, fully-collateralized opportunities.
 *
 * An opportunity is one position a venue offers at a unit cost that either
 * pays its unit gain (probability `winProbability`) or loses the cost. Kalshi
 * contracts, prediction-market shares and any other capped-loss bet take this
 * shape; the allocator knows no venue's vocabulary, only cents.
 *
 * Sizing, in order:
 *   1. lane capital = floor(lane fraction x sum of venue equity);
 *   2. each opportunity's stake = floor(kellyMultiple x kellyFraction x lane
 *      capital) less the risk already held on that instrument;
 *   3. wants on one correlated date are scaled together, proportionally, into
 *      that date's remaining budget;
 *   4. wants are ranked by edge and capped by the event's remaining budget, the
 *      lane's remaining open budget and the venue's free cash;
 *   5. count = floor(room / unit cost); under one contract the opportunity is
 *      skipped with its reason.
 * Kelly comes from position-sizing-service; nothing here computes its own.
 *
 * `sizing.method: 'bayesian-joint'` (opt-in; the default, 'kelly', is exactly the above) replaces step 2's
 * per-opportunity Kelly fraction. Opportunities are grouped by lane and correlation.event; an opportunity may carry
 * `posterior` ({alpha, beta}, Beta on its win probability), whose mean (the Bayes-optimal single-bet winProbability
 * under log utility) replaces winProbability. Each multi-member event requires the caller to state
 * outcomeStructure consistently: exclusive-losses, exclusive-wins, or independent. Marginal probabilities
 * alone cannot establish dependence. The supplied structure is a model assumption, not proof of calibration.
 * Per-event, per-date, open and cash caps then apply unchanged.
 *
 * `sizing.modelRisk: { modes, level }` (only with 'bayesian-joint') adds SHARED MODEL ERROR: `modes` are latent model
 * states `{weight, lambda}` (remainder = calibrated, lambda 1) in which every member's loss probability is scaled by
 * lambda, one state shared by the whole group; `level` is 'date' (default: all of a lane's opportunities settling on
 * one correlation.date share the state, so same-day ladders fail together) or 'event' (one state per ladder). Each
 * group is then sized by position-sizing-service's modelRiskScenarios (E log W over the mixture). Estimate the modes
 * with estimateModelRiskModes. A group whose scenario set would be too large, or has an unsizeable event, falls back
 * to the per-event path above (reported as `fallback` in sizingGroups).
 *
 * Pure: the caller states the world (opportunities, venue cash, existing
 * exposure) and receives intended orders. Nothing is placed here.
 */
import { bayesianBinaryKellyFraction, binaryOutcomeScenarios, jointKellyForCorrelatedOutcomes, kellyFraction, modelRiskScenarios } from '@red-cup-engineering/position-sizing-service';

const integerCents = (value, label) => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label}-must-be-positive-integer-cents`);
  return value;
};
const fractionOf = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label}-invalid`);
  return number;
};
// Exposure may arrive as Maps (a venue book folded in memory) or as plain objects (a record read back).
const lookup = (table, key) => {
  if (!table) return 0;
  if (table instanceof Map) return table.get(key) ?? 0;
  return table[key] ?? 0;
};
const exposureOf = (exposure, lane) => exposure?.lanes?.[lane] ?? exposure ?? {};

/**
 * @param {object} input
 * @param {{id: string, lane: string, venue: string, instrument: {venue: string, id: string, kind: string}, side: string,
 *   priceCents: number, payoffCents: number, winProbability: number, settlesOn: string,
 *   outcomeStructure?: 'exclusive-losses'|'exclusive-wins'|'independent',
 *   correlation: {event: string, date: string}, heldRiskCents?: number, rankEdge?: number}[]} input.opportunities
 *   priceCents is the unit cost of the position bought (its unit risk); payoffCents its unit gain; winProbability is
 *   already conservative. rankEdge, when given, replaces the default ranking edge (winProbability less the break-even
 *   probability priceCents / (priceCents + payoffCents)).
 * @param {{venue: string, equityCents: number, freeCashCents: number, minCashCents?: number}[]} input.venues
 * @param {Record<string, {fraction: number}>} input.lanes
 * @param {{kellyMultiple?: number, method?: 'kelly'|'bayesian-joint', modelRisk?: {modes: {id?: string, weight: number, lambda: number}[], level?: 'date'|'event'}}} input.sizing
 * @param {{perEventFraction: number, perDateFraction: number, maxOpenFraction: number}} input.limits fractions of lane capital.
 * @param {{byEvent?: object|Map, byDate?: object|Map, total?: number, lanes?: Record<string, object>}} [input.exposure]
 *   risk already open (held plus resting), in cents, flat for one lane or under `lanes[laneId]` for several.
 * @returns {{orders: object[], skips: {id: string, reason: string}[], laneCapital: Record<string, number>}}
 */
export function allocateOpportunities({ opportunities, venues, lanes, sizing = {}, limits, exposure = {} } = {}) {
  if (!Array.isArray(opportunities) || !Array.isArray(venues) || !lanes || typeof lanes !== 'object' || !limits) throw new TypeError('opportunities-venues-lanes-and-limits-required');
  const kellyMultiple = sizing.kellyMultiple ?? 1;
  const perEvent = fractionOf(limits.perEventFraction, 'per-event-fraction');
  const perDate = fractionOf(limits.perDateFraction, 'per-date-fraction');
  const maxOpen = fractionOf(limits.maxOpenFraction, 'max-open-fraction');

  const totalEquity = venues.reduce((sum, venue) => sum + venue.equityCents, 0);
  const laneCapital = Object.fromEntries(Object.entries(lanes).map(([lane, { fraction }]) => [lane, Math.floor(totalEquity * fractionOf(fraction, `lane-${lane}-fraction`))]));
  const cashLeft = new Map(venues.map((venue) => [venue.venue, venue.freeCashCents - (venue.minCashCents ?? 0)]));
  const used = new Map(); // lane -> { byEvent: Map, byDate: Map, total }
  const usedOf = (lane) => {
    if (!used.has(lane)) {
      const book = exposureOf(exposure, lane);
      used.set(lane, { book, byEvent: new Map(), byDate: new Map(), total: book.total ?? 0 });
    }
    return used.get(lane);
  };
  const eventUsed = (lane, event) => lookup(usedOf(lane).book.byEvent, event) + (usedOf(lane).byEvent.get(event) ?? 0);
  const dateUsed = (lane, date) => lookup(usedOf(lane).book.byDate, date) + (usedOf(lane).byDate.get(date) ?? 0);

  const method = sizing.method ?? 'kelly';
  if (method !== 'kelly' && method !== 'bayesian-joint') throw new RangeError(`sizing-method-${method}-unknown`);
  const jointFractions = method === 'bayesian-joint' ? jointFractionsFor(opportunities, laneCapital, cashLeft, sizing.modelRisk) : null;
  if (sizing.modelRisk && method !== 'bayesian-joint') throw new RangeError('sizing-model-risk-needs-bayesian-joint');

  const skips = [];
  const wants = [];
  for (const opportunity of opportunities) {
    const { id, lane, venue } = opportunity;
    if (!(lane in laneCapital)) { skips.push({ id, reason: `unknown lane ${lane}` }); continue; }
    if (!cashLeft.has(venue)) { skips.push({ id, reason: `venue ${venue} not in the account reading` }); continue; }
    const cost = integerCents(opportunity.priceCents, `${id}-price`);
    const gain = integerCents(opportunity.payoffCents, `${id}-payoff`);
    const fraction = Math.max(0, (jointFractions ? jointFractions.get(opportunity) : kellyFraction({ winProbability: opportunity.winProbability, payoffRatio: gain / cost })) * kellyMultiple);
    const want = Math.floor(fraction * laneCapital[lane]) - (opportunity.heldRiskCents ?? 0);
    if (fraction <= 0) { skips.push({ id, reason: `no Kelly edge at win probability ${opportunity.winProbability}` }); continue; }
    if (want < cost) { skips.push({ id, reason: 'already holds its Kelly stake' }); continue; }
    const edge = opportunity.rankEdge ?? opportunity.winProbability - cost / (cost + gain);
    wants.push({ opportunity, cost, gain, fraction, want, edge });
  }

  // Simultaneous wants on one correlated date share that date's remaining budget in proportion to their stakes.
  const groups = new Map();
  for (const row of wants) {
    const key = `${row.opportunity.lane}\u0000${row.opportunity.correlation.date}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const { lane, correlation } = group[0].opportunity;
    const budget = Math.floor(perDate * laneCapital[lane]) - dateUsed(lane, correlation.date);
    const total = group.reduce((sum, row) => sum + row.want, 0);
    const scale = total > 0 ? Math.max(0, Math.min(1, budget / total)) : 0;
    for (const row of group) row.want = Math.floor(row.want * scale);
  }

  const orders = [];
  for (const row of [...wants].sort((a, b) => b.edge - a.edge)) {
    const { opportunity, cost, gain, fraction, want, edge } = row;
    const { lane, venue, correlation } = opportunity;
    const capital = laneCapital[lane];
    const room = Math.min(
      want,
      Math.floor(perEvent * capital) - eventUsed(lane, correlation.event),
      Math.floor(maxOpen * capital) - usedOf(lane).total,
      cashLeft.get(venue),
    );
    const count = Math.floor(room / cost);
    if (count < 1) { skips.push({ id: opportunity.id, reason: `no room under the limits (${room}c for ${cost}c a contract)` }); continue; }
    const riskCents = cost * count;
    orders.push({
      id: opportunity.id, lane, venue, instrument: opportunity.instrument, side: opportunity.side,
      priceCents: cost, payoffCents: gain, count, riskCents, edge, winProbability: opportunity.winProbability, kellyFraction: fraction,
      settlesOn: opportunity.settlesOn, correlation,
    });
    const book = usedOf(lane);
    book.byEvent.set(correlation.event, (book.byEvent.get(correlation.event) ?? 0) + riskCents);
    book.byDate.set(correlation.date, (book.byDate.get(correlation.date) ?? 0) + riskCents);
    book.total += riskCents;
    cashLeft.set(venue, cashLeft.get(venue) - riskCents);
  }
  return jointFractions ? { orders, skips, laneCapital, sizingGroups: jointFractions.groups } : { orders, skips, laneCapital };
}


/**
 * Unscaled growth-optimal fraction of lane capital for every opportunity that can be sized, as a Map keyed by the
 * opportunity object (the Map also carries `groups`, one diagnostic row per correlation.event group).
 */
function jointFractionsFor(opportunities, laneCapital, cashLeft, modelRisk) {
  const level = modelRisk?.level ?? 'date';
  if (modelRisk && level !== 'date' && level !== 'event') throw new RangeError(`sizing-model-risk-level-${level}-unknown`);
  const fractions = new Map();
  const groups = new Map();
  for (const opportunity of opportunities) {
    if (!(opportunity.lane in laneCapital) || !cashLeft.has(opportunity.venue)) continue; // skipped later, with its reason
    integerCents(opportunity.priceCents, `${opportunity.id}-price`);
    integerCents(opportunity.payoffCents, `${opportunity.id}-payoff`);
    const key = `${opportunity.lane}\u0000${modelRisk && level === 'date' ? opportunity.correlation.date : opportunity.correlation.event}`;
    groups.set(key, [...(groups.get(key) ?? []), opportunity]);
  }
  const diagnostics = [];
  const winOf = (o) => (o.posterior ? o.posterior.alpha / (o.posterior.alpha + o.posterior.beta) : o.winProbability);
  const isTooLarge = (error) => error instanceof RangeError && /scenario set would exceed|limited to 20/.test(error.message);
  const sizeSharedError = (members) => {
    const result = (() => {
      const sc = modelRiskScenarios({ modes: modelRisk.modes, opportunities: members.map((o) => ({ id: o.id, event: o.correlation.event, priceCents: o.priceCents, payoffCents: o.payoffCents, winProbability: winOf(o), outcomeStructure: o.outcomeStructure })) });
      return { sc, joint: jointKellyForCorrelatedOutcomes({ outcomes: sc.outcomes, scenarios: sc.scenarios, budget: 1, tolerance: 1e-8 }) };
    })();
    members.forEach((o, i) => fractions.set(o, result.joint.fractions[i]));
    return result.sc;
  };
  for (const members of groups.values()) {
    if (modelRisk) {
      try {
        const sc = sizeSharedError(members);
        diagnostics.push({ event: members[0].correlation.event, date: members[0].correlation.date, lane: members[0].lane, ids: members.map((o) => o.id), structure: 'model-risk', level, modes: sc.modes, events: sc.events });
        continue;
      } catch (error) {
        if (!isTooLarge(error)) throw error;
        // too large or unsizeable: size each event on its own below, then per-event structure
        const byEvent = new Map();
        for (const o of members) byEvent.set(o.correlation.event, [...(byEvent.get(o.correlation.event) ?? []), o]);
        let ok = true;
        for (const part of byEvent.values()) {
          try { sizeSharedError(part); } catch (inner) { if (!isTooLarge(inner)) throw inner; ok = false; part.forEach((o, i) => fractions.set(o, bayesianBinaryKellyFraction({ posterior: { mean: winOf(o) }, priceCents: o.priceCents, payoffCents: o.payoffCents }).fraction)); }
        }
        diagnostics.push({ event: members[0].correlation.event, date: members[0].correlation.date, lane: members[0].lane, ids: members.map((o) => o.id), structure: 'model-risk', level, fallback: ok ? 'per-event' : 'single', modes: modelRisk.modes });
        continue;
      }
    }
    const win = members.map((o) => (o.posterior ? o.posterior.alpha / (o.posterior.alpha + o.posterior.beta) : o.winProbability));
    const outcomes = members.map((o) => ({ id: o.id, priceCents: o.priceCents, payoffCents: o.payoffCents }));
    const {structure,scenarios} = binaryOutcomeScenarios(members.map((o,i)=>({...o,winProbability:win[i]})));
    {
      const result = jointKellyForCorrelatedOutcomes({ outcomes, scenarios, budget: 1, tolerance: 1e-8 });
      members.forEach((o, i) => fractions.set(o, result.fractions[i]));
    }
    diagnostics.push({ event: members[0].correlation.event, lane: members[0].lane, ids: members.map((o) => o.id), structure });
  }
  fractions.groups = diagnostics;
  return fractions;
}
