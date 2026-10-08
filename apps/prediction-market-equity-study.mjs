#!/usr/bin/env node
import {openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
import {researchPredictionMarketEquities} from '../src/equity-prediction-market-research.mjs';
const file=process.argv[2],market=process.argv[3]??'KXFED-26OCT-T4.25';
try{
 if(!file||process.argv.length>4)throw new TypeError('usage: prediction-market-equity-study SOURCE_JSON [KXFED_MARKET]');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let text;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>2*1048576)throw new TypeError('bounded-equity-source-file-required');text=readFileSync(fd,'utf8');}finally{closeSync(fd);}
 if(Buffer.byteLength(text)>2*1048576)throw new TypeError('bounded-equity-source-file-required');
 const artifact=await researchPredictionMarketEquities({equitySource:JSON.parse(text),market});
 console.log(JSON.stringify(artifact));
}catch(error){console.error(error.message);process.exitCode=1;}
