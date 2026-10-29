(() => {
  'use strict';
  // After deploying the backend, replace this with its Render URL (no trailing slash).
  const API_BASE_URL = 'https://cordcopyai.onrender.com';
  const $ = id => document.getElementById(id);
  const NOTES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const NOTE_INDEX = Object.fromEntries(NOTES.map((n,i)=>[n,i]));
  const SHAPES = {
    C:{f:[-1,3,2,0,1,0],d:['x','3','2','0','1','0'],fingers:[0,3,2,0,1,0]},D:{f:[-1,-1,0,2,3,2],d:['x','x','0','2','3','2'],fingers:[0,0,0,1,3,2]},E:{f:[0,2,2,1,0,0],d:['0','2','2','1','0','0'],fingers:[0,2,3,1,0,0]},G:{f:[3,2,0,0,0,3],d:['3','2','0','0','0','3'],fingers:[2,1,0,0,0,3]},A:{f:[-1,0,2,2,2,0],d:['x','0','2','2','2','0'],fingers:[0,0,1,2,3,0]},F:{f:[1,3,3,2,1,1],d:['1','3','3','2','1','1'],fingers:[1,3,4,2,1,1]},Am:{f:[-1,0,2,2,1,0],d:['x','0','2','2','1','0'],fingers:[0,0,2,3,1,0]},Dm:{f:[-1,-1,0,2,3,1],d:['x','x','0','2','3','1'],fingers:[0,0,0,2,3,1]},Em:{f:[0,2,2,0,0,0],d:['0','2','2','0','0','0'],fingers:[0,2,3,0,0,0]},Bm:{f:[-1,2,4,4,3,2],d:['x','2','4','4','3','2'],fingers:[0,1,3,4,2,1]},Cm:{f:[-1,3,5,5,4,3],d:['x','3','5','5','4','3'],fingers:[0,1,3,4,2,1]},'F♯m':{f:[2,4,4,2,2,2],d:['2','4','4','2','2','2'],fingers:[1,3,4,1,1,1]}
  };
  const ROOT_ALIASES = {'Db':'C♯','Eb':'D♯','Gb':'F♯','Ab':'G♯','Bb':'A♯','A#':'A♯','C#':'C♯','D#':'D♯','F#':'F♯','G#':'G♯'};
  let audioBuffer = null, audioUrl = null, sourceName = '', results = [], selectedIndex = -1, looping = false, loopTimer = null;
  const player = $('audioPlayer');

  function fmtTime(s){ if(!Number.isFinite(s)||s<0)s=0; return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
  function normalizeRoot(root){ return ROOT_ALIASES[root] || root; }
  function parseChord(chord){ const m = chord.match(/^([A-G](?:♯|♭|#|b)?)(.*)$/); if(!m)return null; let root=normalizeRoot(m[1].replace('♭','b')); let idx=NOTE_INDEX[root]; if(idx===undefined){const b={'Db':1,'Eb':3,'Gb':6,'Ab':8,'Bb':10};idx=b[root];} if(idx===undefined)return null; return {root:idx, suffix:m[2]||''}; }
  function transposeChord(chord, semitones){ if(chord==='N')return 'N'; const p=parseChord(chord); if(!p)return chord; return NOTES[(p.root+semitones+120)%12]+p.suffix; }
  function quality(chord){ const p=parseChord(chord); if(!p)return 'maj'; return /m(?!aj)/i.test(p.suffix)?'min':'maj'; }
  function shapeName(chord){ const p=parseChord(chord); if(!p)return chord; const root=NOTES[p.root]; const q=quality(chord); return root+(q==='min'?'m':''); }
  function setStatus(id,msg,isError=false){ const el=$(id); el.textContent=msg; el.style.color=isError?'var(--danger)':'var(--muted)'; }

  $('audioFile').addEventListener('change', async e => {
    const file=e.target.files && e.target.files[0]; if(!file)return;
    if(file.size > 80*1024*1024){setStatus('fileStatus','파일이 80MB보다 큽니다. 더 짧은 파일을 선택해 주세요.',true);return;}
    try { setStatus('fileStatus',`불러오는 중: ${file.name}`); await loadBlob(file,file.name); setStatus('fileStatus',`선택됨: ${file.name} · ${fmtTime(audioBuffer.duration)}`); $('analyzeFile').disabled=false; setStatus('analysisStatus','음원 준비 완료. 코드 분석을 시작하세요.'); }
    catch(err){setStatus('fileStatus','이 파일을 읽지 못했습니다. MP3/WAV/M4A 파일로 다시 시도해 주세요.',true);console.error(err);}
  });
  async function loadBlob(blob,name){ if(audioUrl)URL.revokeObjectURL(audioUrl); audioUrl=URL.createObjectURL(blob); player.src=audioUrl; sourceName=name; const ctx=new (window.AudioContext||window.webkitAudioContext)(); const data=await blob.arrayBuffer(); audioBuffer=await ctx.decodeAudioData(data.slice(0)); await ctx.close(); results=[]; selectedIndex=-1; renderResults(); $('exportCsv').disabled=true;$('printScore').disabled=true; $('durationLabel').textContent=fmtTime(audioBuffer.duration); $('loopStart').value='0'; $('loopEnd').value=Math.min(10,audioBuffer.duration).toFixed(1); }

  $('openYoutube').addEventListener('click',()=>{const url=validYouTubeUrl($('youtubeUrl').value);if(!url){setStatus('youtubeStatus','올바른 유튜브 링크를 입력해 주세요.',true);return;}window.open(url,'_blank','noopener,noreferrer');setStatus('youtubeStatus','유튜브 영상이 새 탭에서 열렸습니다. 직접 음원 분석에는 파일 또는 서버 연결이 필요합니다.');});
  $('analyzeYoutube').addEventListener('click',async()=>{
    const url=validYouTubeUrl($('youtubeUrl').value);if(!url){setStatus('youtubeStatus','올바른 유튜브 링크를 입력해 주세요.',true);return;}
    setStatus('youtubeStatus','연결된 분석 서버 확인 중…');
    try{const res=await fetch(`${API_BASE_URL}/api/youtube-audio`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});if(!res.ok){let msg='서버에서 음원을 가져오지 못했습니다.';try{const j=await res.json();if(j.error)msg=j.error;}catch{}throw new Error(msg);}const blob=await res.blob();await loadBlob(blob,'YouTube audio');$('analyzeFile').disabled=false;setStatus('youtubeStatus','서버에서 음원을 받아왔습니다. 이제 코드 분석을 시작하세요.');}
    catch(err){setStatus('youtubeStatus',`${err.message||'분석 서버에 연결할 수 없습니다.'} 업로드 파일 분석은 바로 사용할 수 있습니다.`,true);}
  });
  function validYouTubeUrl(raw){try{const u=new URL(raw.trim());if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be'].includes(u.hostname))return null;if(u.hostname.includes('youtu.be')&&!u.pathname.slice(1))return null;if(u.hostname.includes('youtube.com')&&!u.searchParams.get('v')&&!u.pathname.startsWith('/shorts/')&&!u.pathname.startsWith('/embed/'))return null;return u.href;}catch{return null;}}

  $('analyzeFile').addEventListener('click',async()=>{if(!audioBuffer)return;const btn=$('analyzeFile');btn.disabled=true;try{setStatus('analysisStatus','음원을 분석하고 있습니다…');await new Promise(r=>setTimeout(r,20));if(!$('songBpm').dataset.userSet){const detected=estimateBpm(audioBuffer);if(Number.isFinite(detected)&&detected>=40&&detected<=240){$('songBpm').value=String(detected);$('beatStatus').textContent=`자동 추정 BPM ${detected} · 박자가 맞지 않으면 직접 조정하세요.`;}}results=analyzeBuffer(audioBuffer,beatSettings());
      if(window.ChordLensStructure)results=window.ChordLensStructure.refine(results,beatSettings(),audioBuffer.duration);if(!results.length)throw new Error('분석할 구간이 없습니다.');renderResults();$('exportCsv').disabled=false;$('printScore').disabled=false;setStatus('analysisStatus',`완료: 음악적 코드 변화에 따라 ${results.length}개 구간을 추정했어요. 실제 코드 및 타이밍은 확인이 필요합니다.`);selectResult(0);}catch(err){setStatus('analysisStatus',err.message||'분석 중 오류가 발생했습니다.',true);console.error(err);}finally{btn.disabled=false;}});

  function analyzeBuffer(buffer,settings){
    // Analysis windows follow musical subdivisions, not a user-selected second interval.
    const beatSeconds = settings.beatDuration;
    const hopSeconds = 0.115; // Internal acoustic sampling only; never a chord-segment duration.
    const size=8192, sr=buffer.sampleRate, ch0=buffer.getChannelData(0), ch1=buffer.numberOfChannels>1?buffer.getChannelData(1):null;
    const mono=new Float32Array(ch0.length); for(let i=0;i<mono.length;i++)mono[i]=ch1?(ch0[i]+ch1[i])*.5:ch0[i];
    const hop=Math.max(1,Math.floor(sr*hopSeconds)); const frames=[];
    for(let start=0;start<mono.length;start+=hop){ if(start+size>mono.length)break; const re=new Float64Array(size), im=new Float64Array(size); let energy=0;
      for(let i=0;i<size;i++){const v=mono[start+i]*(0.5-0.5*Math.cos(2*Math.PI*i/(size-1)));re[i]=v;energy+=v*v;}
      if(energy/size<1e-7) {frames.push({start:Math.max(0,(start+size/2-hop/2)/sr),end:Math.min((start+size/2+hop/2)/sr,buffer.duration),silent:true});continue;}
      fft(re,im);
      const harmonic=window.ChordLensHarmony;
      if(!harmonic)throw new Error('화성 분석 모듈을 불러오지 못했습니다. 새로고침해 주세요.');
      const {chroma,bass}=harmonic.features(re,im,sr);
      frames.push({start:Math.max(0,(start+size/2-hop/2)/sr),end:Math.min((start+size/2+hop/2)/sr,buffer.duration),scores:harmonic.scores(chroma,bass),silent:false});
    }
    // Smooth the per-frame predictions with a temporal model instead of splitting
    // a sustained chord every four seconds. This reduces flicker, not pitch errors.
    const stable=window.ChordLensHarmony.decode(frames,beatSeconds);
    if(stable.length){stable[0].start=0;stable[stable.length-1].end=buffer.duration;}
    const grouped=[];
    for(const f of stable){
      const last=grouped[grouped.length-1];
      if(last && last.chord===f.chord){
        const oldDuration=last.end-last.start, newDuration=f.end-f.start;
        last.confidence=(last.confidence*oldDuration+f.confidence*newDuration)/(oldDuration+newDuration);
        last.end=f.end;
      } else grouped.push({...f});
    }
    return grouped.filter(r=>r.end-r.start>.05);
  }
  function stabilizeChords(frames,hopSeconds,beatSeconds){
    if(!frames.length)return [];
    // Hysteresis: a new harmony must persist and be more convincing than
    // the current chord. No forced split by seconds or measure boundaries.
    const output=frames.map(f=>({...f}));
    const lookahead=Math.max(3,Math.round(Math.min(.48,beatSeconds*.7)/hopSeconds));
    let current=output[0].chord;
    for(let i=1;i<output.length;i++){
      const proposed=output[i].chord;
      if(proposed===current)continue;
      if(proposed==='N'){
        // Preserve sustained silence, ignore isolated quiet frames.
        let count=0;for(let j=i;j<Math.min(output.length,i+lookahead);j++)if(output[j].chord==='N')count++;
        if(count>=Math.ceil(lookahead*.75))current='N';else output[i].chord=current;
        continue;
      }
      let support=0, total=0;
      for(let j=i;j<Math.min(output.length,i+lookahead);j++){
        if(output[j].chord===proposed)support+=Math.max(.1,output[j].confidence);
        total+=Math.max(.1,output[j].confidence);
      }
      if(support/Math.max(.01,total)>=.68 && output[i].confidence>=.25){
        current=proposed;
      }else output[i].chord=current;
    }
    // Fill isolated short islands surrounded by the same harmony.
    for(let pass=0;pass<2;pass++){
      const runs=[];
      for(let i=0;i<output.length;){let j=i+1;while(j<output.length&&output[j].chord===output[i].chord)j++;runs.push({i,j,chord:output[i].chord});i=j;}
      for(let k=1;k<runs.length-1;k++){
        const r=runs[k],l=runs[k-1],n=runs[k+1];
        if(r.chord!=='N'&&l.chord===n.chord&&r.j-r.i<lookahead){
          for(let i=r.i;i<r.j;i++)output[i].chord=l.chord;
        }
      }
    }
    return output;
  }
  function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len,wr0=Math.cos(angle),wi0=Math.sin(angle);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const u=i+j,v=i+j+len/2,tr=wr*re[v]-wi*im[v],ti=wr*im[v]+wi*re[v];re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const nw=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=nw;}}}}
  function bestChord(chroma){let best={chord:'N',score:0};for(let root=0;root<12;root++)for(const q of ['maj','min']){const template=new Array(12).fill(0);template[root]=1;template[(root+(q==='maj'?4:3))%12]=.85;template[(root+7)%12]=.75;template[(root+2)%12]=.08;template[(root+9)%12]=.08;let dot=0,norm=0;for(let i=0;i<12;i++){dot+=chroma[i]*template[i];norm+=template[i]*template[i];}const score=dot/Math.sqrt(norm);if(score>best.score)best={chord:NOTES[root]+(q==='min'?'m':''),score};}return best;}

  function capoShape(chord){return transposeChord(chord,-Number($('capoFret').value));}
  function renderResults(){
    const wrap=$('chordTimeline');wrap.innerHTML='';
    if(!results.length){wrap.innerHTML='<div class="empty-state">분석 결과가 여기에 표시됩니다.</div>';renderScore();return;}
    results.forEach((r,i)=>{
      const b=document.createElement('button');b.className='chord-card'+(i===selectedIndex?' active':'');
      b.innerHTML=`<strong>${escapeHtml(capoShape(r.chord))}</strong><small>실제 음: ${escapeHtml(r.chord)}</small><small>코드 변화 구간</small>`;
      b.addEventListener('click',()=>selectResult(i));wrap.appendChild(b);
    });renderScore();
  }
  function beatSettings(){
    const bpm=Math.min(240,Math.max(40,Number($('songBpm').value)||120));
    const beats=Number($('timeSignature').value)||4;
    const offset=Math.max(0,Number($('beatOffset').value)||0);
    const beatDuration=60/bpm*(beats===6?.5:1);
    return {bpm,beats,offset,beatDuration,measureDuration:beatDuration*beats};
  }
  function chordAt(t){
    const hit=results.find(r=>t>=r.start&&t<r.end);
    return hit || results.find(r=>r.start>t) || results[results.length-1];
  }
  function renderScore(){
    const score=$('chordScore');score.innerHTML='';
    if(!results.length){score.innerHTML='<div class="empty-state">분석하면 마디별 코드 악보가 표시됩니다.</div>';return;}
    const {bpm,beats,offset,beatDuration,measureDuration}=beatSettings();
    const duration=audioBuffer?.duration||results[results.length-1].end;
    if(window.ChordLensStructure){
      const phrases=window.ChordLensStructure.phrases(results,beatSettings(),duration);
      const overview=document.createElement('div');overview.className='structure-overview';
      const title=document.createElement('strong');title.textContent='곡 진행 요약 (4마디 단위 · 추정)';overview.appendChild(title);
      const line=document.createElement('div');line.className='structure-phrases';
      for(const phrase of phrases){
        const b=document.createElement('button');b.type='button';b.className='structure-phrase';
        b.textContent=phrase.label+' · '+(phrase.chords.slice(0,5).join(' → ')||'N');
        b.title=fmtTime(phrase.start)+'–'+fmtTime(phrase.end);
        b.addEventListener('click',()=>{player.currentTime=phrase.start;updateBeatHighlight();});
        line.appendChild(b);
      }
      overview.appendChild(line);score.appendChild(overview);
    }
    const count=Math.min(1000,Math.max(0,Math.ceil((duration-offset)/measureDuration)));
    for(let m=0;m<count;m++){
      const start=offset+m*measureDuration;
      const measure=document.createElement('div');measure.className='score-measure';measure.dataset.start=start;measure.dataset.end=Math.min(duration,start+measureDuration);
      const head=document.createElement('div');head.className='measure-heading';head.textContent=`${m+1}마디 · ${fmtTime(start)}`;measure.appendChild(head);
      const beatsRow=document.createElement('div');beatsRow.className='measure-beats';
      for(let b=0;b<beats;b++){
        const t=start+b*beatDuration;
        const r=chordAt(Math.min(duration-.001,t+beatDuration*.45));
        const button=document.createElement('button');button.type='button';button.className='measure-beat';button.dataset.time=t;
        const prev = chordAt(Math.max(0,t-beatDuration*.55));
        const chord = r?.chord || 'N';
        const showChord = (m===0 && b===0) || chord !== (prev?.chord || 'N');
        button.innerHTML=`<small>${b+1}</small><strong>${showChord ? escapeHtml(capoShape(chord)) : '—'}</strong>`;
        button.title=`${m+1}마디 ${b+1}박 · ${fmtTime(t)}`;
        button.addEventListener('click',()=>{player.currentTime=Math.min(t,duration);const i=results.indexOf(chordAt(t));if(i>=0)selectResult(i);updateBeatHighlight();});
        beatsRow.appendChild(button);
      }
      measure.appendChild(beatsRow);score.appendChild(measure);
    }
    $('scoreCapoLabel').textContent=`${bpm} BPM · ${$('timeSignature').selectedOptions[0].text} · `+(Number($('capoFret').value)?`카포 ${$('capoFret').value}프렛`:'카포 없음');
    updateBeatHighlight();
  }
  function updateBeatHighlight(){
    const t=player.currentTime;
    const {offset,beatDuration}=beatSettings();
    const index=Math.floor((t-offset)/beatDuration);
    $('chordScore').querySelectorAll('.measure-beat').forEach(el=>{
      const i=Math.round((Number(el.dataset.time)-offset)/beatDuration);
      el.classList.toggle('active',i===index&&index>=0);
    });
  }
  function estimateBpm(buffer){
    // Onset-envelope autocorrelation. A rough tempo hint, not a verified downbeat or meter.
    const sr=buffer.sampleRate, stride=Math.max(1,Math.round(sr/100)), len=Math.min(buffer.length,Math.round(sr*100));
    const channel=buffer.getChannelData(0), bins=Math.floor(len/stride), envelope=new Float64Array(bins);
    for(let i=0;i<bins;i++){let sum=0;const base=i*stride;for(let j=0;j<stride&&base+j<len;j++){const v=channel[base+j];sum+=v*v;}envelope[i]=Math.sqrt(sum/stride);}
    const onset=new Float64Array(bins);for(let i=1;i<bins;i++)onset[i]=Math.max(0,envelope[i]-envelope[i-1]);
    let bestBpm=120,bestScore=-1;
    for(let bpm=60;bpm<=200;bpm++){
      const lag=Math.round(6000/bpm);let score=0;
      for(let i=lag;i<bins;i++)score+=onset[i]*onset[i-lag];
      score/=Math.max(1,bins-lag);
      if(score>bestScore){bestScore=score;bestBpm=bpm;}
    }
    return bestBpm;
  }
  ['songBpm','timeSignature','beatOffset'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='songBpm')$('songBpm').dataset.userSet='1';renderScore();if(results.length)setStatus('analysisStatus','박자 설정이 변경됐습니다. 타이밍을 다시 계산하려면 코드 분석을 다시 눌러 주세요.');}));
  $('detectBpm').addEventListener('click',()=>{
    if(!audioBuffer){$('beatStatus').textContent='먼저 음원을 불러와 주세요.';return;}
    const bpm=estimateBpm(audioBuffer);$('songBpm').value=String(bpm);$('songBpm').dataset.userSet='1';
    $('beatStatus').textContent=`추정 BPM: ${bpm}. 2배/절반 템포로 인식될 수 있으니 실제 박자에 맞춰 조정하세요.`;
    renderScore();
  });
  $('setDownbeat').addEventListener('click',()=>{$('beatOffset').value=player.currentTime.toFixed(2);renderScore();});
  function highlightPlayback(){
    if(!results.length)return;
    const t=player.currentTime;
    updateBeatHighlight();
    let i=results.findIndex(r=>t>=r.start&&t<r.end);
    if(i<0&&t>=results[results.length-1].end)i=results.length-1;
    if(i<0||i===selectedIndex)return;
    selectedIndex=i;refreshSelection(false);
  }
  player.addEventListener('timeupdate',highlightPlayback);

  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function selectResult(i){if(i<0||i>=results.length)return;selectedIndex=i;refreshSelection(true);}
  function refreshSelection(seek){
    if(selectedIndex<0||selectedIndex>=results.length)return;
    const r=results[selectedIndex], shape=capoShape(r.chord);
    $('selectedChord').textContent=r.chord;$('shapeChord').textContent=shape;
    $('fingeringSubtitle').textContent=`${fmtTime(r.start)}–${fmtTime(r.end)} · 신뢰도 참고값 ${(r.confidence*100).toFixed(0)}%`;
    if(seek){$('loopStart').value=r.start.toFixed(2);$('loopEnd').value=r.end.toFixed(2);player.currentTime=Math.min(r.start,Math.max(0,(audioBuffer?.duration||0)-.01));}
    renderResults();drawFingering(shape);
  }
  function drawFingering(chord){
    const wrap=$('fretboard');wrap.innerHTML='';const shape=SHAPES[shapeName(chord)];
    if(!shape){wrap.innerHTML='<div class="empty-state">이 코드의 기본 운지표는 아직 없습니다. 다른 카포 위치나 코드 폼을 참고해 주세요.</div>';return;}
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 340 260');svg.setAttribute('role','img');
    svg.setAttribute('aria-label',`${chord} 기타 운지 그림. 6번 줄부터 1번 줄 순서`);svg.classList.add('chord-diagram');
    const add=(tag,attrs,content)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(content!==undefined)el.textContent=content;svg.appendChild(el);return el;};
    const positives=shape.f.filter(f=>f>0),base=Math.min(...positives)>3?Math.min(...positives):1;
    const x0=54,dx=45,y0=58,dy=36;
    for(let st=0;st<6;st++){const x=x0+st*dx;add('line',{x1:x,y1:y0,x2:x,y2:y0+4*dy,stroke:'#aab7c8','stroke-width':1.5});}
    for(let f=0;f<=4;f++){const y=y0+f*dy;add('line',{x1:x0,y1:y,x2:x0+5*dx,y2:y,stroke:'#aab7c8','stroke-width':f===0&&base===1?5:1.5});}
    if(base>1)add('text',{x:18,y:y0+23,fill:'#d8e4f0','font-size':15,'text-anchor':'middle'},`${base}fr`);
    shape.f.forEach((f,st)=>{const x=x0+st*dx;
      if(f===-1||f===0){add('text',{x,y:42,fill:f===0?'#b8f36b':'#c3cfdd','font-size':19,'text-anchor':'middle'},f===0?'○':'×');return;}
      const y=y0+(f-base+.5)*dy;
      add('circle',{cx:x,cy:y,r:13,fill:'#b8f36b'});
      add('text',{x,y:y+4,fill:'#14210a','font-size':12,'font-weight':800,'text-anchor':'middle'},shape.fingers[st]||'•');
    });
    ['E','A','D','G','B','e'].forEach((label,st)=>add('text',{x:x0+st*dx,y:245,fill:'#aab7c8','font-size':13,'text-anchor':'middle'},label));
    wrap.appendChild(svg);
    const footer=document.createElement('div');footer.className='fingering-footer';footer.innerHTML=`<span>운지: <strong>${escapeHtml(shapeName(chord))}</strong></span><span>● 숫자 = 손가락 번호 · ○ 개방현 · × 치지 않음</span>`;wrap.appendChild(footer);
  }
  $('capoFret').addEventListener('change',()=>{if(selectedIndex>=0)refreshSelection(false);else renderResults();});
  $('printScore').addEventListener('click',()=>{if(results.length)window.print();});
  $('recommendCapo').addEventListener('click',()=>{if(!results.length){setStatus('analysisStatus','먼저 음원을 분석해 주세요.',true);return;}let best={fret:0,score:-1};for(let fret=0;fret<=7;fret++){let score=0;for(const r of results){if(r.chord==='N')continue;const fing=transposeChord(r.chord,-fret);const n=shapeName(fing);score+=((SHAPES[n]?2:0)+(['C','G','D','A','E','Am','Em','Dm'].includes(n)?1:0))*Math.max(.3,r.end-r.start);}if(score>best.score)best={fret,score};}$('capoFret').value=String(best.fret);if(selectedIndex>=0)selectResult(selectedIndex);setStatus('analysisStatus',`추천 카포: ${best.fret===0?'카포 없음':best.fret+'프렛'} · 쉬운 기본 운지 형태가 많이 나오는 위치를 기준으로 한 참고 추천입니다.`);});
  $('loopToggle').addEventListener('click',()=>{looping=!looping;$('loopToggle').textContent=looping?'구간 반복 켜짐':'구간 반복 꺼짐';$('loopToggle').setAttribute('aria-pressed',String(looping));if(looping)startLoopMonitor();else if(loopTimer)clearInterval(loopTimer);});
  function startLoopMonitor(){if(loopTimer)clearInterval(loopTimer);loopTimer=setInterval(()=>{if(!looping||player.paused)return;const end=Number($('loopEnd').value),start=Number($('loopStart').value);if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&player.currentTime>=end){player.currentTime=start;player.play().catch(()=>{});}},100);}
  $('setLoop').addEventListener('click',()=>{let start=Number($('loopStart').value),end=Number($('loopEnd').value);const dur=audioBuffer?.duration||Infinity;if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start){setStatus('analysisStatus','반복 구간의 끝은 시작보다 커야 합니다.',true);return;}start=Math.min(start,dur);end=Math.min(end,dur);$('loopStart').value=start.toFixed(2);$('loopEnd').value=end.toFixed(2);player.currentTime=start;setStatus('analysisStatus',`반복 구간 설정: ${fmtTime(start)}–${fmtTime(end)}${looping?' · 반복 중':''}`);});
  $('exportCsv').addEventListener('click',()=>{if(!results.length)return;const rows=[['start_seconds','end_seconds','chord','confidence','capo_fret','capo_shape'],...results.map(r=>[r.start.toFixed(2),r.end.toFixed(2),r.chord,r.confidence.toFixed(3),$('capoFret').value,transposeChord(r.chord,-Number($('capoFret').value))])];const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chordlens-chords.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
  if('serviceWorker' in navigator && location.protocol!=='file:'){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Service worker registration failed',e)));}
})();
