/**
 * Conditional settlement deductions over bounded numeric outcome domains.
 *
 * Pure proof search for the existing SignCell/FOUR witness carrier:
 *   - if every number admitted by premises lies inside a payout set, support FOR;
 *   - if none lies inside it, support AGAINST;
 *   - otherwise, preserve both live possibilities.
 *
 * No new modal/bilattice data type: returns witnesses in the existing {for,against}
 * shape. Only a source-specific adapter can qualify premises as sound for its
 * exact market rules. The result is conditional on those premises; it is NOT an
 * executable trading authorization, forecast probability, or Kalshi settlement.
 *
 * Empty or inconsistent premise intersections MUST NOT imply every proposition
 * (principle of non-explosion). Contradictory independent witnesses remain
 * visible in both knowledge-order slots.
 */
const validEdge = (x) => typeof x === 'number' && !Number.isNaN(x);
const validInterval = (x) => x && validEdge(x.lower) && validEdge(x.upper) && x.lower <= x.upper;
const nonempty = (x) => typeof x === 'string' && x.trim().length > 0;
const timestamp = (x) => typeof x === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) &&
  Number.isFinite(Date.parse(x));
const intersects = (a,b) => !(a.upper < b.lower || b.upper < a.lower);
const inside = (a,b) => a.lower >= b.lower && a.upper <= b.upper;
const intersection = (a,b) => ({lower:Math.max(a.lower,b.lower), upper:Math.min(a.upper,b.upper)});
const encodeEdge = (x) => x===Infinity?'Infinity':x===-Infinity?'-Infinity':x;
// JSON/SignCell content addresses must not silently encode unbounded endpoints as null.
const asBound = (p) => ({lower:encodeEdge(p.lower),upper:encodeEdge(p.upper)});

/**
 * @param {{payout:{lower:number,upper:number}, premises:Array<{id:string,lower:number,upper:number,observedAt:string,availableAt:string}>,at:string}} input
 * The premise intervals are closed and CONTAIN THE EVENTUAL AUTHORITATIVE
 * outcome, under source/rule assumptions already checked by the caller.
 * Reject malformed evidence; withhold evidence not published by 'at'.
 */
export function deduceSettlementInterval({payout,premises=[],at}={}) {
  if(!validInterval(payout)||!Array.isArray(premises)||!timestamp(at))
    throw new TypeError('closed payout interval, premises and issuance time required');
  const seen=new Set(),used=[],withheld=[],atMs=Date.parse(at);
  for(const p of premises) {
    if(!p||!nonempty(p.id)||!validInterval(p)||!timestamp(p.observedAt)||!timestamp(p.availableAt)||Date.parse(p.availableAt)<Date.parse(p.observedAt))
      throw new TypeError('each premise needs a unique id, valid bounds and observation/availability clocks');
    if(seen.has(p.id))throw new TypeError('duplicate premise identity');
    seen.add(p.id);
    if(Date.parse(p.availableAt)>atMs||Date.parse(p.observedAt)>atMs) {
      withheld.push({id:p.id,reason:'not available at issuance'});continue;
    }
    used.push({id:p.id,lower:p.lower,upper:p.upper});
  }
  used.sort((a,b)=>a.id.localeCompare(b.id));
  const support={for:[],against:[]};
  const add=(interval,ids)=>{
    const fact={premises:ids,interval:asBound(interval),payout:asBound(payout),
      rule:inside(interval,payout)?'interval-subset':!intersects(interval,payout)?'interval-disjoint':null,
      scope:'conditional-on-qualified-settlement-bounds'};
    if(fact.rule==='interval-subset')support.for.push(fact);
    else if(fact.rule==='interval-disjoint')support.against.push(fact);
  };
  for(const p of used)add(p,[p.id]);
  let common=null;
  for(const p of used)common=common===null?asBound(p):intersection(common,p);
  const conflict=common!==null&&common.lower>common.upper;
  if(!conflict&&used.length>1) {
    const combined=asBound(common);
    // The intersection can prove a proposition even when no single premise does.
    // Retain the premise list to make the derivation independently checkable.
    add(combined,used.map(x=>x.id));
  }
  if(conflict) {
    // Non-explosion does not require forgetting every consistent subfamily.
    // For closed intervals on the real line, any finite nonempty intersection
    // is determined by at most TWO bounds: a maximal lower endpoint and a
    // minimal upper endpoint. Therefore a compatible pair can prove a payout
    // even when a third, independent interval makes the total intersection
    // inconsistent. Find one deterministic minimal-size witness in O(n), not
    // by exponential subset enumeration or by accepting an empty intersection.
    //
    // Ignore already-sufficient singleton intervals: they have their own
    // independent witnesses above. A nontrivial pair must tighten the lower
    // boundary from one source and the upper boundary from another.
    let floor=null,ceiling=null;
    for(const p of used) {
      if(inside(p,payout))continue;
      if(p.lower>=payout.lower&&
         (floor===null||p.lower<floor.lower||
          (p.lower===floor.lower&&p.id.localeCompare(floor.id)<0)))
        floor=p;
      if(p.upper<=payout.upper&&
         (ceiling===null||p.upper>ceiling.upper||
          (p.upper===ceiling.upper&&p.id.localeCompare(ceiling.id)<0)))
        ceiling=p;
    }
    if(floor&&ceiling&&floor.id!==ceiling.id) {
      const pair=intersection(floor,ceiling);
      if(validInterval(pair)&&inside(pair,payout))
        add(pair,[floor.id,ceiling.id].sort((a,b)=>a.localeCompare(b)));
    }
  }
  // Do not use the empty intersection as proof of *anything*.
  const openWorld=common===null?null:conflict?null:{
    yes:intersects(common,payout),
    no:!inside(common,payout),
  };
  return {
    support,qualifiedPremises:used.map(x=>x.id),withheld,
    inconsistentPremises:conflict,
    remainingDomain:conflict||common===null?null:asBound(common),
    admissibleWorlds:openWorld,
    // FOUR belongs to SignCell; do not collapse these independent witness arrays
    // into one Boolean, certainty, or internally reinvented four-valued enum.
    orderEffect:false,
  };
}


/**
 * An explicitly CONDITIONAL reachability envelope for a running maximum or
 * minimum under piecewise certified bounds on the *instantaneous rate*.
 *
 * With T' in [rateLower, rateUpper] for EVERY instant in the segment, not just
 * at sampled endpoints, integrate to bound both the terminal temperature and
 * every intermediate excursion. This conditional numerical theorem is not
 * a claim that actual weather obeys a proposed rate envelope.
 *
 * Segments cover the entire remaining observation window without gaps:
 * the first begins at 'at', each ends at 'until', and the final segment
 * must end exactly at 'endAt'. A stale, missing or later-published segment
 * withholds the final bound. Temperatures are real physical quantities;
 * any settlement-source reporting/rounding transform belongs downstream.
 */
export function boundRatePathExtremum({
  kind,at,endAt,temperature,achievedExtreme,segments=[]
}={}) {
  if(!['high','low'].includes(kind)||!timestamp(at)||!timestamp(endAt)||
    !validInterval(temperature)||!validInterval(achievedExtreme)||
    ![temperature.lower,temperature.upper,achievedExtreme.lower,achievedExtreme.upper].every(Number.isFinite)||
    !Array.isArray(segments))
    throw new TypeError('extreme kind, real bounded temperature, prior extreme and observation window required');
  const started=Date.parse(at),finished=Date.parse(endAt);
  if(finished<started)throw new RangeError('observation window ended before issuance');
  if(kind==='high'&&temperature.lower>achievedExtreme.upper||
     kind==='low'&&temperature.upper<achievedExtreme.lower)
    return {status:'inconsistent-initial-extreme',finalExtreme:null,orderEffect:false};
  if(started===finished&&segments.length)
    throw new RangeError('no future segments allowed when the observation period has ended');
  let cursor=started, current={lower:temperature.lower,upper:temperature.upper};
  let extreme={lower:achievedExtreme.lower,upper:achievedExtreme.upper};
  const receipts=[],seen=new Set();
  for(const s of segments){
    if(!s||!nonempty(s.id)||seen.has(s.id)||!timestamp(s.until)||
      !timestamp(s.availableAt)||!timestamp(s.observedAt)||
      Date.parse(s.observedAt)>Date.parse(s.availableAt)||
      !Number.isFinite(s.rateLowerPerHour)||!Number.isFinite(s.rateUpperPerHour)||
      s.rateLowerPerHour>s.rateUpperPerHour)
      throw new TypeError('unique rate certificate, valid interval and publication clocks required');
    seen.add(s.id);
    const until=Date.parse(s.until);
    if(until<=cursor||until>finished)throw new RangeError('rate segments must be strictly increasing and inside the observation window');
    if(Date.parse(s.availableAt)>started) {
      return {status:'rate-bound-not-yet-available',withheld:[s.id],finalExtreme:null,orderEffect:false};
    }
    const hours=(until-cursor)/3600000;
    const endpoint={
      lower:current.lower+s.rateLowerPerHour*hours,
      upper:current.upper+s.rateUpperPerHour*hours,
    };
    // For the MAX, every continuous path must reach its starting and ending
    // temperatures; a rate ceiling controls ANY intermediate upward spike.
    // MIN is the exact order-dual argument.
    if(kind==='high'){
      extreme={
        lower:Math.max(extreme.lower,current.lower,endpoint.lower),
        upper:Math.max(extreme.upper,current.upper,endpoint.upper),
      };
    } else {
      extreme={
        lower:Math.min(extreme.lower,current.lower,endpoint.lower),
        upper:Math.min(extreme.upper,current.upper,endpoint.upper),
      };
    }
    if(![endpoint.lower,endpoint.upper,extreme.lower,extreme.upper].every(Number.isFinite))
      throw new RangeError('temperature reachability overflow');
    receipts.push({id:s.id,until:s.until,availableAt:s.availableAt});
    current=endpoint;cursor=until;
  }
  if(cursor!==finished) {
    return {status:'incomplete-rate-horizon',coveredUntil:new Date(cursor).toISOString(),
      finalExtreme:null,orderEffect:false};
  }
  return {status:'conditional-rate-bounded-reachability',
    finalExtreme:extreme,terminalTemperature:current,
    certificates:receipts,extremumKind:kind,
    assumptions:[
      'initial physical temperature and achieved extreme lie in the supplied intervals',
      'each rate bound applies at every instant in its entire segment',
      'ordered segments cover the full remaining observation window',
      'no implied calibration, source agreement, rounding, correction or venue payout'],
    tradeEligible:false,orderEffect:false};
}
