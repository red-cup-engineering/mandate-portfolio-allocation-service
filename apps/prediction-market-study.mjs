#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {researchPredictionMarketStrategy} from '../src/prediction-market-research.mjs';
const args=process.argv.slice(2);
const opt=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
const output=opt('output');if(!output)throw new TypeError('--output file is required');
const artifact=await researchPredictionMarketStrategy({market:opt('market','KXFED-26OCT-T4.25'),roundTripCostFraction:Number(opt('round-trip-cost','0.005'))});
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,rows:artifact.rows.length,...artifact.study.scores,eligibleForLiveUse:artifact.study.eligibleForLiveUse}));
