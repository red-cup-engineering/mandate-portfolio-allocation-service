/**
 * Principal/venue account border for the shared market game.
 *
 * A venue is NOT an account: the same venue can carry different sovereign
 * principals' capital. Keys are canonical tuple encodings, not ad-hoc
 * delimiters that allow collisions between names.
 *
 * This module is pure and dependency-free so the authority boundary can be
 * executed in CI without an exchange connection or a finance workspace.
 */
const named = value => typeof value === 'string' && value.trim().length > 0;
const venues = new Set(['alpaca', 'kalshi', 'evm']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function principalVenueKey({ principal, venue } = {}) {
  if (!named(principal) || !venues.has(venue))
    throw new TypeError('account requires named principal and supported venue');
  return JSON.stringify([principal, venue]);
}

/** Never let two account rows contribute the same capital twice. */
export function indexPrincipalAccounts(accounts, principal) {
  if (!named(principal) || !accounts || typeof accounts !== 'object' || Array.isArray(accounts))
    throw new TypeError('principal-scoped account collection required');
  const byVenue = new Map();
  for (const account of Object.values(accounts)) {
    principalVenueKey(account);
    if (account.principal !== principal)
      throw new TypeError('funded accounts must belong to the declared decision principal');
    if (byVenue.has(account.venue))
      throw new RangeError('duplicate principal/venue accounts would double-count capital');
    byVenue.set(account.venue, account);
  }
  return byVenue;
}

/** Shared venues demand separate inventory P&L witnesses for each principal. */
export function sharedPrincipalVenues(accounts) {
  const owners = new Map(), shared = new Set();
  for (const account of Object.values(accounts)) {
    principalVenueKey(account);
    const principals = owners.get(account.venue) ?? new Set();
    principals.add(account.principal);
    owners.set(account.venue, principals);
    if (principals.size > 1) shared.add(account.venue);
  }
  return shared;
}

/**
 * Return net change in held wealth (integer cents) for one principal/venue.
 *
 * Legacy venue-only P&L remains valid only when the venue belongs to one
 * principal. A scoped matrix is required when multiple principals share it.
 * This is a valuation, NOT a fungible account balance or authorization.
 */
export function scenarioHeldPnLCents(scenario, principal, venue, { requireScoped = false } = {}) {
  principalVenueKey({ principal, venue });
  const byPrincipal = scenario?.heldPnlCentsByPrincipalVenue;
  const row = byPrincipal && Object.hasOwn(byPrincipal, principal) ? byPrincipal[principal] : null;
  const hasScoped = row && typeof row === 'object' && !Array.isArray(row) && Object.hasOwn(row, venue);
  if (hasScoped) {
    const amount = row[venue];
    if (!finite(amount) || !Number.isSafeInteger(amount))
      throw new TypeError('principal-scoped held P&L must be integer cents');
    return amount;
  }
  if (requireScoped) throw new RangeError('shared venue requires principal-scoped held P&L');
  const legacy = scenario?.heldPnlCentsByVenue?.[venue];
  if (!finite(legacy) || !Number.isSafeInteger(legacy))
    throw new TypeError('held P&L must be supplied in integer cents');
  return legacy;
}
