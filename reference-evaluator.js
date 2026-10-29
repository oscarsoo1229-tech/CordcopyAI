/* ChordLens v11.3 — opt-in reference evaluation. Never affects audio analysis. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChordLensReference = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ALIASES = {Db:1,Eb:3,Gb:6,Ab:8,Bb:10,Cb:11,Fb:4,'E#':5,'B#':0};
  function chordInfo(raw) {
    const c=String(raw||'').trim().replace(/♯/g,'#').replace(/♭/g,'b');
    if(c==='N'||/^(?:NC|N\.C\.|no chord)$/i.test(c))return {label:'N',root:-1,quality:'N',detail:'N'};
    const m=/^([A-G](?:#|b)?)([^\s]*)$/.exec(c);
    if(!m)throw Error('지원하지 않는 코드: '+c);
    let root=NAMES.indexOf(m[1]);if(root<0)root=ALIASES[m[1]];
    if(root===undefined||root<0)throw Error('코드 근음 확인 필요: '+c);
    let suffix=m[2]; const slash=suffix.indexOf('/');
    let inversion='';
    if(slash>=0){inversion=suffix.slice(slash+1);suffix=suffix.slice(0,slash);if(inversion&&!/^([A-G](?:#|b)?)$/.test(inversion))throw Error('슬래시 코드 확인 필요: '+c);}
    const lower=suffix.toLowerCase();let quality='maj';
    if(/^(?:m|min|minor)(?!aj)/.test(suffix))quality='min';
    if(/dim|°|m7b5|ø/i.test(suffix))quality='dim';
    if(/aug|\+/i.test(suffix))quality='aug';
    if(/sus2/i.test(suffix))quality='sus2';
    if(/sus4|sus(?!2)/i.test(suffix))quality='sus4';
    let normal=lower.replace(/^minor/,'m').replace(/^min/,'m').replace(/^major/,'maj').replace(/△/g,'maj');
    // 'M7' conventional notation means major seventh, not minor seventh.
    if(/^M7/.test(suffix))normal='maj7'+suffix.slice(2).toLowerCase();
    if(/^M(?![a-z])/.test(suffix))normal='maj'+suffix.slice(1).toLowerCase();
    if(!suffix)normal='';
    let inv='';if(inversion){const p=chordInfo(inversion);inv='/'+p.label;}
    return {label:NAMES[root]+normal+inv,root,quality,detail:normal+inv,inversionRoot:inversion?chordInfo(inversion).root:null};
  }
  function transpose(chord,capo){const c=chordInfo(chord);if(c.root<0)return 'N';const i=c.detail.indexOf('/');return NAMES[(c.root+capo+1200)%12]+(i<0?c.detail:c.detail.slice(0,i)+'/'+NAMES[(c.inversionRoot+capo+1200)%12]);}
  function parseRows(text,mode){
    const rows=[];String(text).replace(/^\uFEFF/,'').split(/\r?\n/).forEach((line,n)=>{
      line=line.trim();if(!line||line.startsWith('#')||/^start_seconds\s*,/i.test(line)||/^bar_start\s*,/i.test(line))return;
      const parts=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
      if(parts.length!==3)throw Error(`${n+1}행: 시작,끝,코드 순서로 입력해 주세요.`);
      const [s,e,chord]=parts;
      let start=Number(s),end=Number(e);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error(`${n+1}행: 시작과 끝 숫자를 확인해 주세요.`);
      if(mode==='bars'&&(!Number.isInteger(start)||!Number.isInteger(end)||start<1))throw Error(`${n+1}행: 마디 번호는 1 이상의 정수여야 해요.`);
      chordInfo(chord);
      rows.push({start,end,chord});
    });
    if(!rows.length)throw Error('정답 코드가 입력되지 않았어요.');
    if(rows.length>4000)throw Error('정답 구간은 최대 4000개까지 지원해요.');
    rows.sort((a,b)=>a.start-b.start||a.end-b.end);
    for(let i=1;i<rows.length;i++)if(rows[i].start<rows[i-1].end-1e-7)throw Error('정답 구간 시간이 서로 겹쳐요: '+(i+1)+'번째 구간');
    return rows;
  }
  function compile(rows,{mode,capo=0,bpm=120,beats=4,offset=0,duration=Infinity}){
    if(!Number.isFinite(capo)||capo<0||capo>12||!Number.isInteger(capo))throw Error('악보 카포는 0~12프렛 사이로 설정해 주세요.');
    if(mode==='bars'&&(!Number.isFinite(bpm)||bpm<=0||!Number.isFinite(beats)||beats<=0||!Number.isFinite(offset)||offset<0))throw Error('BPM·박자·첫 마디 시작 시간을 확인해 주세요.');
    const barLen=60/bpm*beats*(beats===6?0.5:1);
    const computed=rows.map(r=>{
      const start=mode==='bars'?offset+(r.start-1)*barLen:r.start;
      const end=mode==='bars'?offset+(r.end-1)*barLen:r.end;
      return {start,end,chord:transpose(r.chord,capo),written:r.chord};
    });
    const clipped=computed.map(r=>({...r,start:Math.max(0,r.start),end:Math.min(duration,r.end)})).filter(r=>r.end>r.start);
    if(!clipped.length)throw Error('정답 구간이 음원 재생 범위 밖에 있어요. BPM과 첫 마디 위치를 확인해 주세요.');
    for(let i=1;i<clipped.length;i++)if(clipped[i].start<clipped[i-1].end-1e-7)throw Error('변환된 정답 구간이 겹쳐요.');
    return clipped;
  }
  function evaluate(predictions,reference,{boundaryTolerance=1.0}={}){
    if(!Array.isArray(predictions)||!predictions.length)throw Error('먼저 음원을 분석해 주세요.');
    if(!reference.length)throw Error('정답 구간이 비어 있어요.');
    const pred=predictions.map(r=>({start:Number(r.start),end:Number(r.end),chord:chordInfo(r.chord)}));
    const ref=reference.map(r=>({start:Number(r.start),end:Number(r.end),chord:chordInfo(r.chord),written:r.written}));
    for(const p of pred)if(!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.end<=p.start)throw Error('분석 결과 시간 데이터가 올바르지 않아요.');
    let total=0,exact=0,rootHit=0,qualityHit=0;
    const details=[];
    const mismatches=[];
    const EPS=1e-8;
    for(let ri=0;ri<ref.length;ri++){
      const r=ref[ri];let seconds=0,ex=0,rh=0,qh=0;const distribution=new Map();
      for(const p of pred){
        const dt=Math.max(0,Math.min(p.end,r.end)-Math.max(p.start,r.start));if(dt<=EPS)continue;
        if(p.chord.label!==r.chord.label){
          const start=Math.max(p.start,r.start),end=Math.min(p.end,r.end);
          const prev=mismatches[mismatches.length-1];
          if(prev&&prev.reference===r.chord.label&&prev.predicted===p.chord.label&&Math.abs(prev.end-start)<1e-6)prev.end=end;
          else mismatches.push({start,end,reference:r.chord.label,predicted:p.chord.label});
        }
        seconds+=dt;
        if(p.chord.label===r.chord.label)ex+=dt;
        if(p.chord.root===r.chord.root)rh+=dt;
        if(p.chord.root===r.chord.root&&p.chord.quality===r.chord.quality)qh+=dt;
        distribution.set(p.chord.label,(distribution.get(p.chord.label)||0)+dt);
      }
      total+=seconds;exact+=ex;rootHit+=rh;qualityHit+=qh;
      const dominant=[...distribution].sort((a,b)=>b[1]-a[1])[0]?.[0]||'없음';
      details.push({start:r.start,end:r.end,reference:r.chord.label,written:r.written||'',predicted:dominant,covered:seconds,exactSeconds:ex,rootSeconds:rh,triadSeconds:qh,exactPercent:seconds?ex/seconds*100:null});
    }
    if(total<=0)throw Error('음원 분석 결과와 정답 구간이 겹치지 않아요.');
    // Only evaluate boundaries between adjacent, contiguous reference segments.
    const targets=[];
    for(let i=1;i<ref.length;i++)if(Math.abs(ref[i-1].end-ref[i].start)<0.03&&ref[i-1].chord.label!==ref[i].chord.label)targets.push(ref[i].start);
    const predBounds=pred.slice(1).filter((p,i)=>p.chord.label!==pred[i].chord.label).map(p=>p.start);
    const boundaryErrors=targets.map(t=>predBounds.length?Math.min(...predBounds.map(p=>Math.abs(p-t))):Infinity);
    const matched=boundaryErrors.filter(e=>e<=boundaryTolerance);
    const referenceDuration=ref.reduce((n,r)=>n+r.end-r.start,0);
    return {seconds:total,referenceSeconds:referenceDuration,coverage:total/referenceDuration*100,exactPercent:exact/total*100,rootPercent:rootHit/total*100,triadPercent:qualityHit/total*100,details,mismatches,boundaries:targets.length,boundaryMatched:matched.length,boundaryTolerance,boundaryMAE:matched.length?matched.reduce((s,x)=>s+x,0)/matched.length:null};
  }
  function toCsv(rows){return '\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');}
  return {chordInfo,transpose,parseRows,compile,evaluate,toCsv};
});
