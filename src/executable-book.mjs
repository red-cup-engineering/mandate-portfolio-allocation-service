/**
 * Execution-quality measurement for the market game's EXISTING quote carriers.
 * Pure and source-neutral: consumes one original side-specific bid/ask reading
 * and answers whether it is sufficiently fresh and liquid to be considered by
 * the existing principal-/mandate-bounded portfolio planner.
 *
 * No second receipt, venue client, account, ledger, probability, price
 * predictor, order, or invented authority. The caller must independently
 * authenticate the book's source and account for costs, venue fees and queue
 * fills. Missing fields are UNKNOWN, never zero spreads or infinite liquidity.
 *
 * Prices and askSize must describe the SAME purchased side and unit as the
 * proposed market-game quote (YES and NO are different purchased instruments).
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const named=x=>typeof x==='string'&&x.trim().length>0;
const instant=x=>typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  Number.isFinite(Date.parse(x));

export function assessExecutableBook({
  book,at,maxQuoteAgeMs=60_000,maxRelativeSpread=0.005,
  minUnits=0,proposedEntryPrice=null,
}={}){
  if(!instant(at)||!Number.isSafeInteger(maxQuoteAgeMs)||
     maxQuoteAgeMs<1||maxQuoteAgeMs>3_600_000||
     !finite(maxRelativeSpread)||maxRelativeSpread<0||
     maxRelativeSpread>1||!finite(minUnits)||minUnits<0||
     (proposedEntryPrice!==null&&
       (!finite(proposedEntryPrice)||proposedEntryPrice<=0)))
    throw new TypeError('absolute decision clock and bounded quote-quality policy required');
  const fail=(reason)=>Object.freeze({
    eligibleForPlanning:false,reason,
    // No financial or venue execution is granted by this measurement.
    orderEffect:false,sourceAuthenticated:false,
  });
  if(!book||typeof book!=='object'||Array.isArray(book)||
     !named(book.sourceRef)||!instant(book.observedAt)||
     !finite(book.bid)||!finite(book.ask)||
     !finite(book.bidSize)||!finite(book.askSize))
    return fail('missing original side-specific bid/ask, clock, sizes or source');
  if(book.bid<=0||book.ask<=0||book.ask<book.bid||
     book.bidSize<0||book.askSize<0)
    return fail('invalid or crossed execution book');
  const quoteAgeMs=Date.parse(at)-Date.parse(book.observedAt);
  if(quoteAgeMs<0)return fail('book from future of decision');
  if(quoteAgeMs>maxQuoteAgeMs)return fail('executable quote stale');
  const midpoint=(book.bid+book.ask)/2;
  const relativeSpread=(book.ask-book.bid)/midpoint;
  if(!finite(relativeSpread)||relativeSpread>maxRelativeSpread)
    return fail('bid/ask spread exceeds executable policy');
  if(book.askSize<minUnits)return fail('insufficient displayed ask-side liquidity');
  // A modeled BUY must never be cheaper than the only displayed executable
  // ask without separate, qualified price-improvement/fill observations.
  if(proposedEntryPrice!==null &&
     proposedEntryPrice<book.ask-1e-12*Math.max(1,book.ask))
    return fail('modeled purchase price improves on ask without source evidence');
  return Object.freeze({
    eligibleForPlanning:true,reason:null,quoteAgeMs,
    relativeSpread,bid:book.bid,ask:book.ask,
    maxDisplayedUnits:book.askSize,
    sourceAuthenticated:false,orderEffect:false,
  });
}
