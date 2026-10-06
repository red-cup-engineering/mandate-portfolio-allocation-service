/** Selected public facts from a market play. No account or order projection. */
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';

export const RESEARCH_KIND = 'koios.news.market-research/v1';
const text = (v, label, max = 500) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new TypeError(label + ' requires bounded text');
  return v;
};
const instant = (v) => { text(v, 'instant', 40); if (!Number.isFinite(Date.parse(v))) throw new TypeError('invalid instant'); return v; };
const web = (v) => { const u = new URL(v); if (u.protocol !== 'https:' || u.username || u.password) throw new TypeError('public HTTPS source required'); return u.href; };
const keys = (value, allowed) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new TypeError('undeclared research fields'); };
function safePath(path) {
  if (!Array.isArray(path) || path.length > 12 || path.some(k => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k))) throw new TypeError('bounded safe field path required');
}
export function selectedValue(value, path) {
  safePath(path);
  for (const k of path) { if (value == null || !Object.hasOwn(Object(value), k)) throw new TypeError('missing field ' + k); value = value[k]; }
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 500) || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('publish selected scalar facts, not source bodies');
  return value;
}

/** The explicit assignment chooses facts, their meanings and the upstream wire. */
export function createResearchPublication(state, assignment, at) {
  instant(at);
  if (!Array.isArray(assignment.fields) || !assignment.fields.length || assignment.fields.length > 128) throw new RangeError('select 1..128 research fields');
  const observations = new Map();
  const facts = assignment.fields.map(field => {
    const source = field.observationId ? state.observations[field.observationId] : Object.values(state.observations)
      .filter(row => row.externalId === field.externalId && Date.parse(row.observedAt) <= Date.parse(at))
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id))[0];
    if (!source || Date.parse(source.observedAt) > Date.parse(at) || Date.parse(source.availableAt) > Date.parse(at)) throw new TypeError('research requires already available observations');
    const value = selectedValue(source.value, field.path);
    const record = { id: source.id, source: web(source.source), lineage: text(source.lineage ?? source.externalId ?? source.id, 'lineage'),
      externalId: String(source.externalId ?? source.id), availableAt: source.availableAt, observedAt: source.observedAt,
      recordDigest: hashPosition(source), ...(source.retrieval ? { responseDigest: source.retrieval.responseDigest } : {}) };
    observations.set(record.id, record);
    return { observationId: record.id, path: field.path, subject: text(field.subject, 'fact subject'),
      predicate: text(field.predicate, 'fact predicate'), label: text(field.label, 'fact label'), value,
      ...(field.unit ? { unit: text(field.unit, 'unit', 80) } : {}) };
  });
  const body = { kind: RESEARCH_KIND, issuedAt: at, title: text(assignment.title, 'research title'),
    question: text(assignment.question, 'research question', 2000), producer: { wire: text(assignment.wire, 'upstream wire'),
      actor: web(assignment.producer), license: text(assignment.license, 'license', 2000) },
    derivation: { position: hashPosition(state), observationIds: [...observations.keys()].sort() },
    observations: [...observations.values()].sort((a, b) => a.id.localeCompare(b.id)), facts };
  return parseResearchPublication({ id: hashPosition(body), ...body });
}

export function parseResearchPublication(packet) {
  if (!packet || packet.kind !== RESEARCH_KIND || new TextEncoder().encode(JSON.stringify(packet)).length > 262144) throw new TypeError('bounded market research packet required');
  const { id, ...body } = packet;
  keys(packet, ['id', 'kind', 'issuedAt', 'title', 'question', 'producer', 'derivation', 'observations', 'facts']);
  keys(packet.producer, ['wire', 'actor', 'license']); keys(packet.derivation, ['position', 'observationIds']);
  if (hashPosition(body) !== id) throw new TypeError('research content address differs');
  instant(packet.issuedAt); text(packet.title, 'title'); text(packet.question, 'question', 2000);
  text(packet.producer?.wire, 'wire'); web(packet.producer?.actor); text(packet.producer?.license, 'license', 2000);
  if (!Array.isArray(packet.observations) || !packet.observations.length || packet.observations.length > 128 ||
      !Array.isArray(packet.facts) || !packet.facts.length || packet.facts.length > 128) throw new RangeError('bounded research observations and facts required');
  const sources = new Map();
  for (const source of packet.observations) {
    keys(source, ['id', 'source', 'lineage', 'externalId', 'availableAt', 'observedAt', 'recordDigest', 'responseDigest']);
    text(source.id, 'source id'); web(source.source); instant(source.observedAt); instant(source.availableAt);
    if (sources.has(source.id) || Date.parse(source.availableAt) > Date.parse(source.observedAt) || Date.parse(source.observedAt) > Date.parse(packet.issuedAt)) throw new TypeError('invalid source clock or duplicate source');
    if (!/^[a-f0-9]{64}$/.test(source.recordDigest)) throw new TypeError('source content address required');
    sources.set(source.id, source);
  }
  const used = new Set(), fields = new Set();
  for (const fact of packet.facts) {
    keys(fact, ['observationId', 'path', 'subject', 'predicate', 'label', 'value', 'unit']);
    if (!sources.has(fact.observationId)) throw new TypeError('fact lacks declared observation');
    text(fact.subject, 'subject'); text(fact.predicate, 'predicate'); text(fact.label, 'label');
    if (fact.unit !== undefined) text(fact.unit, 'unit', 80);
    selectedValue({ value: fact.value }, ['value']); safePath(fact.path);
    if (!fact.path.length) throw new TypeError('research field path required');
    const key = JSON.stringify([fact.observationId, fact.path]);
    if (fields.has(key)) throw new TypeError('duplicate research field'); fields.add(key); used.add(fact.observationId);
    if (packet.facts.some(other => other !== fact && other.observationId === fact.observationId &&
        other.path.length < fact.path.length && other.path.every((k, i) => fact.path[i] === k))) throw new TypeError('overlapping scalar research paths');
  }
  if (used.size !== sources.size || JSON.stringify([...used].sort()) !== JSON.stringify(packet.derivation?.observationIds) ||
      !/^[a-f0-9]{64}$/.test(packet.derivation?.position ?? '')) throw new TypeError('research derivation differs from selected facts');
  return structuredClone(packet);
}

/** Purchased research reenters the game as observations, never as an inferred edge. */
export function researchObservationMoves(payload, at) {
  const packet = parseResearchPublication(payload.research ?? payload); instant(at);
  if (Date.parse(packet.issuedAt) > Date.parse(at)) throw new TypeError('research not yet issued');
  return packet.observations.map(source => {
    const value = {};
    for (const fact of packet.facts.filter(f => f.observationId === source.id)) {
      let cursor = value;
      for (let i = 0; i < fact.path.length; i++) {
        const k = fact.path[i];
        if (i === fact.path.length - 1) cursor[k] = fact.value;
        else cursor = cursor[k] ??= {};
      }
    }
    const body = { source: source.source, externalId: packet.id + ':' + source.id, availableAt: packet.issuedAt,
      observedAt: at, lineage: source.lineage, value: { kind: 'published-research', packetId: packet.id, upstreamObservationId: source.id, fields: value } };
    return { kind: 'observe', observation: { id: hashPosition(body), ...body } };
  });
}
