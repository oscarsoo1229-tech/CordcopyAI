/* ChordLens harmonic analysis v5. Offline, browser-only; no external dependencies.
   Log-frequency pitch-class weighting and whole-song Viterbi decoding.
   This is a DSP baseline, NOT a trained chord-recognition model. */
(function(){
  'use strict';
  const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const TYPES=[['', [0,4,7]],['m',[0,3,7]],['7',[0,4,7,10]],['m7',[0,3,7,10]],['maj7',[0,4,7,11]],['sus4',[0,5,7]]];
  const STATES=[];
  for(let root=0;root<12;root++)for(const [suffix,intervals] of TYPES){
    const weights=new Float64Array(12);for(const [i,step] of intervals.entries())weights[(root+step)%12]=i===0?1.2:1;
    STATES.push({name:NAMES[root]+suffix,root,weights});
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
      out[s]=2.8*dot/Math.sqrt(norm)-.50*Math.sqrt(nonChord)+.22*bass[state.root]-complexity;
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
  // v9.1: Detect boundaries from harmonic novelty, then classify entire regions.
  // Short FFT hops are only measurements; they are NOT output chord durations.
  function segment(frames, beatDuration, duration){
    if(!frames.length)return [];
    const hop=Math.max(.04,frames.length>1?frames[1].start-frames[0].start:.115);
    const n=frames.length, states=STATES.length;
    const normalized=frames.map(f=>{
      if(f.silent||!f.chroma)return null;
      const a=f.chroma;let norm=0;for(let i=0;i<12;i++)norm+=a[i]*a[i];
      norm=Math.sqrt(norm)||1;return Array.from(a,v=>v/norm);
    });
    // Compare local chroma averages on each side; reject isolated noisy peaks.
    const radius=Math.max(2,Math.round(.28/hop));
    const novelty=new Float64Array(n);
    for(let t=radius;t<n-radius;t++){
      const left=new Float64Array(12),right=new Float64Array(12);let lc=0,rc=0;
      for(let k=t-radius;k<t;k++)if(normalized[k]){for(let j=0;j<12;j++)left[j]+=normalized[k][j];lc++;}
      for(let k=t;k<t+radius;k++)if(normalized[k]){for(let j=0;j<12;j++)right[j]+=normalized[k][j];rc++;}
      if(lc<radius/2||rc<radius/2)continue;
      let dot=0,ll=0,rr=0;
      for(let j=0;j<12;j++){dot+=left[j]*right[j];ll+=left[j]*left[j];rr+=right[j]*right[j];}
      novelty[t]=1-dot/(Math.sqrt(ll*rr)||1);
    }
    // Peaks must be locally prominent and separated by a musical minimum.
    const minGap=Math.max(.34,Math.min(.75,(Number(beatDuration)||.5)*.65));
    const gapFrames=Math.max(2,Math.round(minGap/hop));
    const candidates=[];
    for(let t=radius+1;t<n-radius-1;t++){
      const v=novelty[t];if(v<.105||v<novelty[t-1]||v<novelty[t+1])continue;
      let baseline=0,count=0;
      for(let k=Math.max(radius,t-radius*2);k<=Math.min(n-radius-1,t+radius*2);k++){
        if(Math.abs(k-t)<radius/2)continue;baseline+=novelty[k];count++;
      }
      if(v-(count?baseline/count:0)<.035)continue;
      candidates.push({t,v});
    }
    candidates.sort((a,b)=>b.v-a.v);
    const boundaries=[0,n];
    for(const c of candidates){
      if(boundaries.every(b=>Math.abs(b-c.t)>=gapFrames))boundaries.push(c.t);
    }
    boundaries.sort((a,b)=>a-b);
    // Classify a region by the mean evidence across all its frames, not a single frame.
    const regions=[];
    for(let b=0;b<boundaries.length-1;b++){
      const from=boundaries[b],to=boundaries[b+1],sum=new Float64Array(states);
      let valid=0;
      for(let t=from;t<to;t++)if(!frames[t].silent&&frames[t].scores){
        for(let k=0;k<states;k++)sum[k]+=frames[t].scores[k];valid++;
      }
      const start=from?Math.max(0,(frames[from-1].end+frames[from].start)/2):0;
      const end=to<n?Math.max(start,(frames[to-1].end+frames[to].start)/2):duration;
      if(end<=start)continue;
      if(!valid){regions.push({start,end,chord:'N',confidence:0,scores:null});continue;}
      for(let k=0;k<states;k++)sum[k]/=valid;
      regions.push({start,end,scores:sum,confidence:0});
    }
    // Dynamic programming over regions. Switching costs depend on region length:
    // short speculative segments need stronger evidence than long ones.
    const R=regions.length;if(!R)return [];
    const dp=[],back=[];
    for(let i=0;i<R;i++){
      const reg=regions[i],scores=reg.scores;
      dp[i]=new Float64Array(states+1);back[i]=new Uint8Array(states+1);
      const len=Math.max(.1,reg.end-reg.start);
      for(let s=0;s<=states;s++){
        const evidence=s===states?(scores?-1.0:1):(scores?scores[s]:-4);
        if(i===0){dp[i][s]=evidence*len;continue;}
        let best=-Infinity,bestFrom=0;
        for(let p=0;p<=states;p++){
          const penalty=p===s?0:(.46+.25/Math.sqrt(len));
          const v=dp[i-1][p]-penalty;
          if(v>best){best=v;bestFrom=p;}
        }
        dp[i][s]=best+evidence*len;back[i][s]=bestFrom;
      }
    }
    let state=0;for(let s=1;s<=states;s++)if(dp[R-1][s]>dp[R-1][state])state=s;
    const out=new Array(R);
    for(let i=R-1;i>=0;i--){
      const reg=regions[i],score=reg.scores&&state<states?reg.scores[state]:0;
      out[i]={start:reg.start,end:reg.end,chord:state===states?'N':STATES[state].name,confidence:state===states?0:Math.max(0,Math.min(1,score/3))};
      if(i>0)state=back[i][state];
    }
    const merged=[];
    for(const r of out){const last=merged[merged.length-1];
      if(last&&last.chord===r.chord){const a=last.end-last.start,b=r.end-r.start;last.confidence=(last.confidence*a+r.confidence*b)/(a+b);last.end=r.end;}
      else merged.push({...r});
    }
    return merged;
  }
  window.ChordLensHarmony={features,scores,decode,segment};
})();
