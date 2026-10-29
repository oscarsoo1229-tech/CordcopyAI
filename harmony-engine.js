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
      const complexity=state.name.endsWith('maj7')?.16:state.name.endsWith('sus4')?.14:state.name.endsWith('m7')?.11:state.name.endsWith('7')?.10:0;
      out[s]=2.8*dot/Math.sqrt(norm)-.50*Math.sqrt(nonChord)+.22*bass[state.root]-complexity;
    }
    // N is selected for near-silent frames separately; avoid spurious N on music.
    out[STATES.length]=-.25;
    return out;
  }
  function decode(frames,beatDuration){
    if(!frames.length)return [];
    const count=STATES.length+1,T=frames.length;
    const back=new Uint8Array(T*count);
    let prev=new Float64Array(count),next=new Float64Array(count);
    const silentScore=(s,silent)=>silent?(s===count-1?1.2:-3):s===count-1?-2:0;
    for(let s=0;s<count;s++)prev[s]=frames[0].silent?silentScore(s,true):frames[0].scores[s]+silentScore(s,false);
    // A switch requires persistent acoustic evidence. The penalty is in the
    // same units as frame emission scores, not elapsed seconds.
    const changePenalty=2.1;
    for(let t=1;t<T;t++){
      for(let s=0;s<count;s++){
        let best=-Infinity,from=0;
        for(let p=0;p<count;p++){
          const value=prev[p]-(p===s?0:changePenalty);
          if(value>best){best=value;from=p;}
        }
        next[s]=best+(frames[t].silent?silentScore(s,true):frames[t].scores[s]+silentScore(s,false));
        back[t*count+s]=from;
      }
      [prev,next]=[next,prev];
    }
    let state=0;for(let s=1;s<count;s++)if(prev[s]>prev[state])state=s;
    const path=new Uint8Array(T);
    for(let t=T-1;t>=0;t--){path[t]=state;if(t>0)state=back[t*count+state];}
    // Remove very short islands only when their neighbors agree. This avoids
    // creating invented changes from isolated bass notes or vocal ornaments.
    const hop=T>1?Math.max(.02,frames[1].start-frames[0].start):.115;
    const minFrames=Math.max(2,Math.round(Math.min(.38,Math.max(.18,beatDuration*.40))/hop));
    for(let pass=0;pass<2;pass++){
      const runs=[];
      for(let i=0;i<T;){let j=i+1;while(j<T&&path[j]===path[i])j++;runs.push({i,j,s:path[i]});i=j;}
      for(let k=1;k<runs.length-1;k++){
        const a=runs[k-1],b=runs[k],c=runs[k+1];
        if(b.j-b.i<minFrames&&a.s===c.s&&b.s!==count-1){
          for(let i=b.i;i<b.j;i++)path[i]=a.s;
        }
      }
    }
    return frames.map((frame,i)=>{
      const s=path[i],scores=frame.scores;
      if(s===count-1||frame.silent)return {start:frame.start,end:frame.end,chord:'N',confidence:0};
      let runner=-Infinity;
      for(let j=0;j<STATES.length;j++)if(j!==s)runner=Math.max(runner,scores[j]);
      const margin=scores[s]-runner;
      return {start:frame.start,end:frame.end,chord:STATES[s].name,
        confidence:Math.max(0,Math.min(1,.5+margin*.5))};
    });
  }
  window.ChordLensHarmony={features,scores,decode};
})();
