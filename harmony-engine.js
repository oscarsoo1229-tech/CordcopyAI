/* ChordLens harmonic analysis v9.7 recovery trace experimental. Offline, browser-only; no external dependencies.
   Log-frequency pitch-class weighting and whole-song Viterbi decoding.
   This is a DSP baseline, NOT a trained chord-recognition model. */
(function(){
  'use strict';
  const VERSION='v9.7-recovery-1';
  let lastTrace=null;
  const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const TYPES=[['', [0,4,7]],['m',[0,3,7]],['7',[0,4,7,10]],['m7',[0,3,7,10]],['maj7',[0,4,7,11]],['sus4',[0,5,7]]];
  const STATES=[];
  for(let root=0;root<12;root++)for(const [suffix,intervals] of TYPES){
    const weights=new Float64Array(12);for(const [i,step] of intervals.entries())weights[(root+step)%12]=i===0?1.2:1;
    STATES.push({name:NAMES[root]+suffix,root,suffix,weights});
  }
  function features(re,im,sr){
    const n=re.length, chroma=new Float64Array(12),bass=new Float64Array(12);
    // Approximate log-frequency chroma using FFT peak interpolation and octave weighting.
    // This is not a mathematically exact CQT.
    for(let k=2;k<n/2-1;k++){
      const freq=k*sr/n;if(freq<55||freq>2200)continue;
      const mag=Math.hypot(re[k],im[k]);
      const left=Math.hypot(re[k-1],im[k-1]),right=Math.hypot(re[k+1],im[k+1]);
      if(mag<left||mag<right)continue;
      const denom=left-2*mag+right;
      const shift=Math.abs(denom)>1e-9?Math.max(-.5,Math.min(.5,.5*(left-right)/denom)):0;
      const pitch=69+12*Math.log2(((k+shift)*sr/n)/440);
      const center=Math.round(pitch),diff=Math.abs(pitch-center);
      if(diff>.45)continue;
      const pc=((center%12)+12)%12;
      const amplitude=Math.sqrt(mag)*Math.pow(1-diff/.5,1.3);
      chroma[pc]+=amplitude/Math.pow(Math.max(freq,80)/220,.18);
      if(freq<300)bass[pc]+=amplitude;
    }
    for(const arr of [chroma,bass]){const norm=Math.hypot(...arr)||1;for(let i=0;i<12;i++)arr[i]/=norm;}
    return {chroma,bass};
  }
  function scores(chroma,bass){
    const out=new Float64Array(STATES.length+1);
    for(let s=0;s<STATES.length;s++){
      const state=STATES[s],w=state.weights;
      let dot=0,norm=0,nonChord=0;
      for(let p=0;p<12;p++){dot+=chroma[p]*w[p];norm+=w[p]*w[p];if(!w[p])nonChord+=chroma[p]*chroma[p];}
      const complexity=(state.name.endsWith('maj7')||state.name.endsWith('m7')||state.name.endsWith('sus4')||state.name.endsWith('7'))?.055:0;
      let extensionPenalty=0;
      // Compare the characteristic tone against the competing major/minor third.
      // Weak extension evidence should not turn a plain triad into a seventh/sus chord.
      const pc=i=>chroma[(state.root+i)%12];
      if(state.suffix==='sus4')extensionPenalty=.22*Math.max(0,pc(4)-pc(5))+.10*Math.max(0,pc(3)-pc(5));
      if(state.suffix==='7'||state.suffix==='m7')extensionPenalty=.12*Math.max(0,.28-pc(10));
      if(state.suffix==='maj7')extensionPenalty=.15*Math.max(0,.28-pc(11));
      out[s]=2.8*dot/Math.sqrt(norm)-.50*Math.sqrt(nonChord)+.16*bass[state.root]-complexity-extensionPenalty;
    }
    // N is selected for near-silent frames separately; avoid spurious N on music.
    out[STATES.length]=-.25;
    return out;
  }
  function decode(frames,beatDuration){
    if(!frames.length)return [];
    const count=STATES.length+1, T=frames.length;
    const back=new Uint8Array(T*count);
    let prev=new Float64Array(count),next=new Float64Array(count);
    for(let s=0;s<count;s++)prev[s]=frames[0].silent?(s===count-1?1:-4):frames[0].scores[s];
    // Transition penalty discourages chord flicker but never forces changes on a timer.
    const changePenalty=.60;
    for(let t=1;t<T;t++){
      for(let s=0;s<count;s++){
        let best=-Infinity,from=0;
        for(let p=0;p<count;p++){
          const transition=p===s?0:changePenalty;
          const value=prev[p]-transition;
          if(value>best){best=value;from=p;}
        }
        next[s]=best+(frames[t].silent?(s===count-1?1:-4):frames[t].scores[s]);
        back[t*count+s]=from;
      }
      [prev,next]=[next,prev];
    }
    let state=0;for(let s=1;s<count;s++)if(prev[s]>prev[state])state=s;
    const path=new Uint8Array(T);
    for(let t=T-1;t>=0;t--){path[t]=state;if(t>0)state=back[t*count+state];}
    return frames.map((frame,i)=>({start:frame.start,end:frame.end,chord:path[i]===STATES.length?'N':STATES[path[i]].name,confidence:frame.silent?0:Math.max(0,Math.min(1,(frame.scores[path[i]]||0)/3))}));
  }
  // v9.2: adaptive harmonic change detection with candidate-chord evidence.
  // Frame hops are measurements, not fixed-length output segments.
  function segment(frames,beatDuration,duration){
    if(!frames.length)return [];
    const n=frames.length, states=STATES.length;
    const hop=n>1?Math.max(.035,frames[1].start-frames[0].start):.115;
    const radius=Math.max(2,Math.round(.38/hop));
    const minGap=Math.max(.38,Math.min(.8,(Number(beatDuration)||.5)*.72));
    const gap=Math.max(2,Math.round(minGap/hop));
    const normalized=frames.map(f=>{
      if(f.silent||!f.chroma)return null;
      const v=f.chroma, norm=Math.hypot(...v)||1;
      return Array.from(v,x=>x/norm);
    });
    const chromaPrefix=Array.from({length:12},()=>new Float64Array(n+1));
    const scorePrefix=Array.from({length:states},()=>new Float64Array(n+1));
    const validPrefix=new Uint32Array(n+1);
    for(let t=0;t<n;t++){
      validPrefix[t+1]=validPrefix[t]+(normalized[t]?1:0);
      for(let j=0;j<12;j++)chromaPrefix[j][t+1]=chromaPrefix[j][t]+(normalized[t]?.[j]||0);
      for(let j=0;j<states;j++)scorePrefix[j][t+1]=scorePrefix[j][t]+(!frames[t].silent&&frames[t].scores?frames[t].scores[j]:0);
    }
    function ranked(a,b){
      const count=validPrefix[b]-validPrefix[a];if(!count)return {id:-1,score:-Infinity,margin:0};
      let best=-Infinity,second=-Infinity,id=-1;
      for(let j=0;j<states;j++){
        const value=(scorePrefix[j][b]-scorePrefix[j][a])/count;
        if(value>best){second=best;best=value;id=j;}else if(value>second)second=value;
      }
      return {id,score:best,margin:best-second};
    }
    function difference(t,r){
      const a=Math.max(0,t-r),b=Math.min(n,t+r);
      const lc=validPrefix[t]-validPrefix[a],rc=validPrefix[b]-validPrefix[t];
      if(lc<2||rc<2)return 0;
      let dot=0,ll=0,rr=0;
      for(let j=0;j<12;j++){
        const l=(chromaPrefix[j][t]-chromaPrefix[j][a])/lc;
        const rrj=(chromaPrefix[j][b]-chromaPrefix[j][t])/rc;
        dot+=l*rrj;ll+=l*l;rr+=rrj*rrj;
      }
      return Math.max(0,1-dot/(Math.sqrt(ll*rr)||1));
    }
    const novelty=new Float64Array(n);
    const values=[];
    for(let t=radius;t<n-radius;t++){novelty[t]=difference(t,radius);values.push(novelty[t]);}
    values.sort((a,b)=>a-b);
    const median=values[Math.floor(values.length*.5)]||0;
    const upper=values[Math.floor(values.length*.8)]||0;
    // A quiet song needs a lower threshold; a busy arrangement needs a higher one.
    const threshold=Math.max(.035,Math.min(.15,median*.55+upper*.35));
    const candidates=[];
    for(let t=radius+1;t<n-radius-1;t++){
      const v=novelty[t];if(v<threshold||v<novelty[t-1]||v<novelty[t+1])continue;
      let baseline=0,count=0;
      for(let k=Math.max(radius,t-radius*2);k<=Math.min(n-radius-1,t+radius*2);k++){
        if(Math.abs(k-t)<Math.max(1,radius/2))continue;
        baseline+=novelty[k];count++;
      }
      const prominence=v-(count?baseline/count:0);
      if(prominence<Math.max(.009,threshold*.16))continue;
      const left=ranked(Math.max(0,t-radius*2),t);
      const right=ranked(t,Math.min(n,t+radius*2));
      // Prefer actual chord-candidate changes over percussion-only chroma spikes.
      const different=left.id>=0&&right.id>=0&&left.id!==right.id;
      const support=different?Math.min(.15,Math.max(0,left.margin+right.margin)*.35):0;
      candidates.push({t,strength:v+prominence*.6+support,different});
    }
    candidates.sort((a,b)=>b.strength-a.strength);
    const boundaries=[0,n];
    for(const c of candidates){
      if(boundaries.every(b=>Math.abs(b-c.t)>=gap))boundaries.push(c.t);
    }
    boundaries.sort((a,b)=>a-b);
    // v9.3: re-evaluate *all* regions using duration-weighted harmonic evidence.
    // This recovers missed changes without inserting artificial time-grid boundaries.
    // A split is accepted only if two different harmonies explain the observations
    // better than one harmony, with local chroma change as supporting evidence.
    // Trace why candidates are rejected. Use per-frame evidence rather than
    // multiplying a whole-region score improvement by the analysis hop size.
    const rejection={tooShort:0,sameHarmony:0,insufficientFrames:0,weakGain:0,weakChange:0};
    let evaluatedSplits=0, bestObservedGain=0, bestObservedChange=0;
    function bestSplit(a,b){
      const length=b-a;
      if(length<2*gap || length*hop<2.4){rejection.tooShort++;return null;}
      const whole=ranked(a,b), step=length>350?3:1;
      let choice=null;
      for(let t=a+gap;t<=b-gap;t+=step){
        evaluatedSplits++;
        const left=ranked(a,t),right=ranked(t,b);
        if(left.id<0||right.id<0||left.id===right.id){rejection.sameHarmony++;continue;}
        const lc=validPrefix[t]-validPrefix[a],rc=validPrefix[b]-validPrefix[t];
        if(lc<5||rc<5){rejection.insufficientFrames++;continue;}
        // Compare one harmonic model to two, on a common per-frame scale.
        const gain=(left.score*lc+right.score*rc-whole.score*(lc+rc))/(lc+rc);
        const local=difference(t,Math.max(2,Math.round(.55/hop)));
        bestObservedGain=Math.max(bestObservedGain,gain);
        bestObservedChange=Math.max(bestObservedChange,local);
        if(gain<.042){rejection.weakGain++;continue;}
        if(local<.018 && gain<.075){rejection.weakChange++;continue;}
        const quality=gain+.40*local;
        if(!choice||quality>choice.quality)choice={t,quality};
      }
      return choice;
    }
    const initialBoundaryCount=boundaries.length;
    let recoveryAttempts=0, recoveryAccepted=0;
    // Conservative cap prevents runaway fragmentation on busy recordings.
    for(let iteration=0;iteration<3 && recoveryAccepted<16;iteration++){
      let inserted=0;
      for(let i=0;i<boundaries.length-1 && recoveryAccepted<16;i++){
        const a=boundaries[i],b=boundaries[i+1];
        recoveryAttempts++;
        const split=bestSplit(a,b);
        if(split){boundaries.splice(i+1,0,split.t);inserted++;recoveryAccepted++;i++;}
      }
      if(!inserted)break;
    }
    // Region-level Viterbi. Evidence is integrated over time, not sampled at one instant.
    const regions=[];
    for(let i=0;i<boundaries.length-1;i++){
      const a=boundaries[i],b=boundaries[i+1];
      const start=a?Math.max(0,(frames[a-1].end+frames[a].start)/2):0;
      const end=b<n?Math.max(start,(frames[b-1].end+frames[b].start)/2):duration;
      if(end<=start)continue;
      const count=validPrefix[b]-validPrefix[a];
      const scores=count?new Float64Array(states):null;
      if(scores)for(let j=0;j<states;j++)scores[j]=(scorePrefix[j][b]-scorePrefix[j][a])/count;
      regions.push({start,end,scores});
    }
    if(!regions.length)return [];
    const R=regions.length,dp=[],back=[];
    for(let i=0;i<R;i++){
      const reg=regions[i],len=Math.max(.1,reg.end-reg.start);
      dp[i]=new Float64Array(states+1);back[i]=new Uint8Array(states+1);
      for(let s=0;s<=states;s++){
        const evidence=s===states?(reg.scores?-1:1):(reg.scores?reg.scores[s]:-4);
        if(i===0){dp[i][s]=evidence*len;continue;}
        let best=-Infinity,from=0;
        for(let p=0;p<=states;p++){
          const penalty=p===s?0:(.34+.20/Math.sqrt(len));
          const value=dp[i-1][p]-penalty;
          if(value>best){best=value;from=p;}
        }
        dp[i][s]=best+evidence*len;back[i][s]=from;
      }
    }
    let state=0;for(let s=1;s<=states;s++)if(dp[R-1][s]>dp[R-1][state])state=s;
    const decoded=new Array(R);
    for(let i=R-1;i>=0;i--){
      const reg=regions[i],score=reg.scores&&state<states?reg.scores[state]:0;
      decoded[i]={start:reg.start,end:reg.end,chord:state===states?'N':STATES[state].name,confidence:state===states?0:Math.max(0,Math.min(1,score/3))};
      if(i>0)state=back[i][state];
    }
    const merged=[];
    for(const r of decoded){const last=merged[merged.length-1];
      if(last&&last.chord===r.chord){const a=last.end-last.start,b=r.end-r.start;last.confidence=(last.confidence*a+r.confidence*b)/(a+b);last.end=r.end;}
      else merged.push({...r});
    }
    const longest=merged.reduce((best,r)=>Math.max(best,r.end-r.start),0);
    lastTrace={version:VERSION,frameCount:n,noveltyMedian:median,noveltyThreshold:threshold,
      candidatePeaks:candidates.length,initialBoundaries:initialBoundaryCount,
      recoveryAttempts,recoveryAccepted,rejection,evaluatedSplits,bestObservedGain,bestObservedChange,finalBoundaries:boundaries.length,
      decodedRegions:decoded.length,mergedSegments:merged.length,longestSeconds:longest,
      timestamp:new Date().toISOString()};
    return merged;
  }
  // Read-only diagnostics: does not alter the segmentation or decoding model.
  function topCandidates(frameScores,count=2){
    if(!frameScores)return [];
    return Array.from(frameScores,(score,i)=>({name:i===STATES.length?'N':STATES[i]?.name,score}))
      .filter(x=>x.name && Number.isFinite(x.score)).sort((a,b)=>b.score-a.score).slice(0,count);
  }
  function localChange(frames,index,radius=4){
    const average=(a,b)=>{
      const sum=new Float64Array(12);let count=0;
      for(let i=Math.max(0,a);i<Math.min(frames.length,b);i++){
        const c=frames[i].chroma;if(!c)continue;
        for(let k=0;k<12;k++)sum[k]+=c[k];count++;
      }
      return count?Array.from(sum,v=>v/count):null;
    };
    const left=average(index-radius,index),right=average(index,index+radius);
    if(!left||!right)return 0;
    let dot=0,a=0,b=0;
    for(let k=0;k<12;k++){dot+=left[k]*right[k];a+=left[k]*left[k];b+=right[k]*right[k];}
    return Math.max(0,1-dot/(Math.sqrt(a*b)||1));
  }
  window.ChordLensHarmony={version:VERSION,features,scores,decode,segment,topCandidates,localChange,getLastTrace:()=>lastTrace?{...lastTrace}:null};
})();
