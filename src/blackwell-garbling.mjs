/**
 * Blackwell comparison of finite information experiments on ONE forecast.
 *
 * A coarse observation Y is a garbling of a finer observation Z if there is
 * a stochastic kernel G(y | z) such that for every predeclared scenario s:
 *
 *   K_coarse(y | s) = SUM_z K_fine(z | s) * G(y | z).
 *
 * Then for ANY common finite action menu and utility U(a,s),
 * EVSI(fine) >= EVSI(coarse), prior to differences in acquisition cost.
 * The result follows by replacing each coarse contingent action with a
 * (possibly randomized) finer-signal policy that samples G.
 *
 * This module verifies the claimed finite factorization; it neither fits
 * signal models nor authenticates their empirical calibration. A string
 * saying "dominates" is never sufficient. No new ledger, SignCell carrier,
 * execution authorization, or independent observation is created here.
 */
const named=x=>typeof x==='string'&&x.trim().length>0;
const stamp=x=>typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  Number.isFinite(Date.parse(x));
const probability=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const own=(object,ids)=>object&&typeof object==='object'&&
  !Array.isArray(object)&&Object.keys(object).length===ids.length&&
  ids.every(id=>Object.hasOwn(object,id));
const total=xs=>xs.reduce((sum,x)=>sum+x,0);
const normalized=(xs)=>Math.abs(total(xs)-1)<=
  32*Number.EPSILON*Math.max(1,xs.length);
const equalComputed=(a,b)=>Math.abs(a-b)<=
  32*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b))+Number.MIN_VALUE;

/**
 * `garbling` is a dense stochastic matrix represented as
 * {fineSignalId:{coarseSignalId:probability}}.
 *
 * This is a mathematical theorem conditional on the declared kernels.
 * Both kernels must predate `at` and explicitly name this forecast;
 * the actual competence of either statistical model is not established.
 *
 * Throws on a malformed or false factorization. Returns true only when the
 * entire joint scenario-by-signal equation has been checked numerically.
 */
export function assertBlackwellGarbling({
 forecast,finerModel,coarserModel,garbling,at,
}={}) {
 if(!stamp(at)||!named(forecast?.id)||!stamp(forecast?.observedAt)||
    (forecast.availableAt!==undefined&&!stamp(forecast.availableAt))||
    Date.parse(forecast.observedAt)>Date.parse(forecast.availableAt??forecast.observedAt)||
    Date.parse(forecast.availableAt??forecast.observedAt)>Date.parse(at)||
    !Array.isArray(forecast.scenarios)||forecast.scenarios.length<2||
    forecast.scenarios.length>512)
   throw new TypeError('bounded, available point-in-time common joint forecast required');
 const scenarioIds=forecast.scenarios.map(s=>s?.id);
 if(scenarioIds.some(id=>!named(id))||new Set(scenarioIds).size!==scenarioIds.length||
    forecast.scenarios.some(s=>!probability(s.probability))||
    !normalized(forecast.scenarios.map(s=>s.probability)))
   throw new TypeError('normalized unique shared scenarios required');
 const checkModel=model=>{
   if(!named(model?.id)||!stamp(model.availableAt)||
      Date.parse(model.availableAt)>Date.parse(at)||
      model.conditionedOnForecastId!==forecast.id||
      !Array.isArray(model.sourceEvidenceIds)||!model.sourceEvidenceIds.length||
      model.sourceEvidenceIds.some(x=>!named(x))||
      !Array.isArray(model.signals)||model.signals.length<2||
      model.signals.length>128)
     throw new TypeError('available source-linked signal model bound to this exact forecast required');
   const ids=model.signals.map(s=>s?.id);
   if(ids.some(x=>!named(x))||new Set(ids).size!==ids.length)
     throw new TypeError('unique finite signal labels required');
   for(const signal of model.signals)
     if(!own(signal.likelihoodByScenario,scenarioIds)||
        scenarioIds.some(s=>!probability(signal.likelihoodByScenario[s])))
       throw new TypeError('complete conditional signal probabilities required');
   for(const scenario of scenarioIds)
     if(!normalized(model.signals.map(z=>z.likelihoodByScenario[scenario])))
       throw new RangeError('signal emissions must normalize in each common world');
   return ids;
 };
 const fine=checkModel(finerModel),coarse=checkModel(coarserModel);
 if(!own(garbling,fine))
   throw new TypeError('garbling must name every fine signal exactly once');
 for(const fineId of fine) {
   const row=garbling[fineId];
   if(!own(row,coarse)||coarse.some(id=>!probability(row[id]))||
      !normalized(coarse.map(id=>row[id])))
     throw new RangeError('garbling must be a row-stochastic fine-to-coarse kernel');
 }
 const fineSignals=new Map(finerModel.signals.map(s=>[s.id,s]));
 const coarseSignals=new Map(coarserModel.signals.map(s=>[s.id,s]));
 for(const scenarioId of scenarioIds)for(const coarseId of coarse) {
   const value=total(fine.map(fineId=>
     fineSignals.get(fineId).likelihoodByScenario[scenarioId]*
     garbling[fineId][coarseId]));
   const required=coarseSignals.get(coarseId).likelihoodByScenario[scenarioId];
   if(!equalComputed(value,required))
     throw new RangeError('coarse experiment does not factor through declared finer experiment');
 }
 return true;
}


/**
 * Discover—not merely accept a claimant's assertion of—the Blackwell
 * ordering of TWO binary signal experiments. Each world's fine event rate f_s
 * and coarse event rate c_s must obey
 *
 *     c_s = g1 + (g0-g1) f_s,
 *
 * with g0,g1 in [0,1]. Two separated f_s determine these coefficients. All
 * other worlds are independently checked by assertBlackwellGarbling; absent a
 * well-conditioned, complete factorization, return null.
 *
 * This is exhaustive for well-separated binary experiments but intentionally
 * conservative for nearly uninformative/ill-conditioned models. It never
 * infers calibration skill or a new source.
 */
export function inferBinaryBlackwellGarbling({
 forecast,finerModel,coarserModel,at,
}={}) {
 if(!Array.isArray(forecast?.scenarios)||forecast.scenarios.length<2||
    !Array.isArray(finerModel?.signals)||finerModel.signals.length!==2||
    !Array.isArray(coarserModel?.signals)||coarserModel.signals.length!==2)
   return null;
 const f0=finerModel.signals[0],f1=finerModel.signals[1];
 const c0=coarserModel.signals[0],c1=coarserModel.signals[1];
 if(!named(f0?.id)||!named(f1?.id)||!named(c0?.id)||!named(c1?.id)||
    f0.id===f1.id||c0.id===c1.id)return null;
 const rows=forecast.scenarios.map(s=>({
   f:f0.likelihoodByScenario?.[s.id],
   c:c0.likelihoodByScenario?.[s.id],
 }));
 if(rows.some(x=>!probability(x.f)||!probability(x.c)))return null;
 const lower=rows.reduce((a,b)=>a.f<=b.f?a:b);
 const upper=rows.reduce((a,b)=>a.f>=b.f?a:b);
 const spread=upper.f-lower.f;
 let g0,g1;
 if(spread<=64*Number.EPSILON){
   // A constant fine experiment can only simulate a constant coarse one;
   // use a constant garbling row and still verify every scenario.
   g0=g1=rows[0].c;
 }else{
   const slope=(upper.c-lower.c)/spread;
   g1=lower.c-slope*lower.f;
   g0=g1+slope;
 }
 const clamp=x=>x>=-64*Number.EPSILON&&x<=1+64*Number.EPSILON
   ?Math.max(0,Math.min(1,x)):null;
 g0=clamp(g0);g1=clamp(g1);
 if(g0===null||g1===null)return null;
 const kernel={
   [f0.id]:{[c0.id]:g0,[c1.id]:1-g0},
   [f1.id]:{[c0.id]:g1,[c1.id]:1-g1},
 };
 try{
   assertBlackwellGarbling({forecast,finerModel,coarserModel,garbling:kernel,at});
   return kernel;
 }catch{
   return null;
 }
}
