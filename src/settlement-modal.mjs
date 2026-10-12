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
const timestamp = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
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
