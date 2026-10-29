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
    STATES.push({name:NAMES[root]+suffix,root,suffix,intervals,weights});
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
      // Extended chords need audible evidence of their distinctive note.
      // This is a general rule, never a song-specific chord whitelist.
      const root=state.root;
      const thirdMajor=chroma[(root+4)%12], thirdMinor=chroma[(root+3)%12];
      const fifth=chroma[(root+7)%12];
      let evidencePenalty=0;
      if(state.suffix==='7'||state.suffix==='m7'||state.suffix==='maj7'){
        const seventh=chroma[(root+(state.suffix==='maj7'?11:10))%12];
        const core=Math.max(.12,chroma[root],fifth,thirdMajor,thirdMinor);
        // If the 7th is weak relative to the chord's other tones, prefer triads.
        evidencePenalty+=.23*Math.max(0,1-seventh/(core*.65));
      }
      if(state.suffix==='sus4'){
        const fourth=chroma[(root+5)%12];
        const core=Math.max(.12,chroma[root],fifth);
        evidencePenalty+=.26*Math.max(0,1-fourth/(core*.70));
        evidencePenalty+=.16*Math.min(1,Math.max(thirdMajor,thirdMinor)/Math.max(.12,fourth));
      }
      // Avoid overconfidence from a single strong bass note.
      out[s]=2.8*dot/Math.sqrt(norm)-.50*Math.sqrt(nonChord)+.16*bass[root]-evidencePenalty;

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
    const changePenalty=.82;
    for(let t=1;t<T;t++){
      for(let s=0;s<count;s++){
        let best=-Infinity,from=0;
        for(let p=0;p<count;p++){
          // A change to a closely related chord should still require
          // sustained acoustic evidence, rather than a single noisy frame.
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
  window.ChordLensHarmony={features,scores,decode};
})();
