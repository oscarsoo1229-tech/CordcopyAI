/* ChordLens v11.2 — score comparison UI, isolated from the analysis engine. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), ref=window.ChordLensReference;
  if(!ref)return;
  let last=null;
  function status(msg,bad=false){$('referenceStatus').textContent=msg;$('referenceStatus').style.color=bad?'var(--danger)':'var(--muted)';}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
  function settings(){
    return {mode:$('referenceMode').value,capo:Number($('referenceCapo').value),bpm:Number($('songBpm').value),beats:Number($('timeSignature').value),offset:Number($('beatOffset').value),duration:window.ChordLensEvaluationBridge?.getDuration()||Infinity};
  }
  function evaluateClick(){
    try{
      const bridge=window.ChordLensEvaluationBridge;
      if(!bridge||!bridge.getSegments().length)throw Error('먼저 MP3를 분석해 주세요.');
      const s=settings(),rows=ref.parseRows($('referenceText').value,s.mode),compiled=ref.compile(rows,s);
      const data=ref.evaluate(bridge.getSegments(),compiled);
      if(s.mode==='bars'&&!$('referenceAligned').checked)throw Error('먼저 박자와 첫 마디 시작을 실제 음원에 맞춘 후 동기화 확인을 체크해 주세요.');
      const revision=bridge.getRevision();
      last={data,compiled,source:bridge.getSourceName(),revision};
      const pct=n=>n.toFixed(1)+'%';
      $('referenceResults').hidden=false;
      $('referenceMetrics').innerHTML=`<div><small>근음 일치율</small><strong>${pct(data.rootPercent)}</strong></div><div><small>기본 코드 일치율</small><strong>${pct(data.triadPercent)}</strong></div><div><small>전체 코드 일치율</small><strong>${pct(data.exactPercent)}</strong></div><div><small>검증 구간</small><strong>${data.seconds.toFixed(1)}초</strong></div>`;
      const boundary=data.boundaries?` · 코드 변경 ±${data.boundaryTolerance}초 이내 ${data.boundaryMatched}/${data.boundaries}개`:'';
      status(`정답 구간 ${compiled.length}개 평가 · 정답 구간의 ${data.coverage.toFixed(1)}%가 분석 결과와 겹침${boundary}.`);
      const escape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      $('referenceDetail').innerHTML=`<table><thead><tr><th>시간(초)</th><th>정답</th><th>주요 추정</th><th>정확한 코드 일치</th></tr></thead><tbody>${data.details.map(r=>`<tr><td>${r.start.toFixed(1)}–${r.end.toFixed(1)}</td><td>${escape(r.reference)}</td><td>${escape(r.predicted)}</td><td>${r.exactPercent===null?'—':r.exactPercent.toFixed(1)+'%'}</td></tr>`).join('')}</tbody></table>`;
      $('exportReferenceEvaluation').disabled=false;
    }catch(e){last=null;$('referenceResults').hidden=true;$('exportReferenceEvaluation').disabled=true;status('평가할 수 없음: '+(e.message||e),true);}
  }
  $('referenceMode').addEventListener('change',()=>{
    $('referenceModeHelp').textContent=$('referenceMode').value==='bars'?'시작 마디,끝 다음 마디,악보 코드 (예: 9,11,G → 9~10마디)':'시작 초,끝 초,실제/악보 코드 (예: 12.5,16.5,B)';
    $('referenceAlignedRow').hidden=$('referenceMode').value!=='bars';
    $('referenceAligned').checked=false;
    status('정답의 시간 범위를 확인한 다음 비교해 주세요.');
  });
  $('referencePreset').addEventListener('click',()=>{
    $('referenceMode').value='bars';$('referenceMode').dispatchEvent(new Event('change'));
    $('referenceCapo').value='4';$('referenceText').value='# 예시 악보: Verse/Chorus의 9~16마디 (전체 곡 정답 아님)\n9,11,G\n11,13,D\n13,15,Em\n15,17,C';
    status('악보 예시를 입력했어요. 음원과 9~16마디를 정확히 맞춘 뒤 동기화 확인을 체크하세요.');
  });
  $('referenceFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>2_000_000)throw Error('2MB 이하 CSV만 불러올 수 있어요.');
      const raw=(await file.text()).replace(/^\uFEFF/,'');
      const lines=raw.split(/\r?\n/).filter(x=>x.trim());if(!lines.length)throw Error('CSV가 비어 있어요.');
      const head=lines[0].replaceAll('"','').toLowerCase().trim();
      let mode;
      if(/^start_seconds,end_seconds,chord/.test(head))mode='seconds';
      else if(/^bar_start,bar_end,chord/.test(head))mode='bars';
      else throw Error('CSV 헤더는 start_seconds,end_seconds,chord 또는 bar_start,bar_end,chord 이어야 해요.');
      const body=lines.slice(1).join('\n');ref.parseRows(body,mode);
      $('referenceMode').value=mode;$('referenceMode').dispatchEvent(new Event('change'));
      $('referenceText').value=body;
      status(`정답 CSV ${file.name}을 불러왔어요. 악보 카포와 시간 동기화를 확인하세요.`);
    }catch(err){status('정답 CSV 오류: '+err.message,true);}finally{e.target.value='';}
  });
  function exportFiles(){
    const bridge=window.ChordLensEvaluationBridge;
    if(!last||!bridge||last.revision!==bridge.getRevision())return [];
    const {data,compiled}=last;
    const refCsv=ref.toCsv([['start_seconds','end_seconds','chord','written_chord'],...compiled.map(r=>[r.start.toFixed(3),r.end.toFixed(3),r.chord,r.written])]);
    const detCsv=ref.toCsv([['start_seconds','end_seconds','reference','written','dominant_prediction','covered_seconds','exact_seconds','root_seconds','basic_chord_seconds'],...data.details.map(r=>[r.start.toFixed(3),r.end.toFixed(3),r.reference,r.written,r.predicted,r.covered.toFixed(3),r.exactSeconds.toFixed(3),r.rootSeconds.toFixed(3),r.triadSeconds.toFixed(3)])]);
    const sumCsv=ref.toCsv([['metric','value'],['source',last.source],['reference_seconds',data.referenceSeconds.toFixed(3)],['evaluated_seconds',data.seconds.toFixed(3)],['coverage_percent',data.coverage.toFixed(2)],['root_accuracy_percent',data.rootPercent.toFixed(2)],['basic_chord_accuracy_percent',data.triadPercent.toFixed(2)],['exact_accuracy_percent',data.exactPercent.toFixed(2)],['boundary_tolerance_seconds',data.boundaryTolerance],['boundary_matches',data.boundaryMatched],['reference_boundaries',data.boundaries],['matched_boundary_mae_seconds',data.boundaryMAE===null?'':data.boundaryMAE.toFixed(3)]]);
    return [{name:'reference.csv',blob:new Blob([refCsv],{type:'text/csv;charset=utf-8'})},{name:'evaluation_details.csv',blob:new Blob([detCsv],{type:'text/csv;charset=utf-8'})},{name:'evaluation_summary.csv',blob:new Blob([sumCsv],{type:'text/csv;charset=utf-8'})}];
  }
  $('evaluateReference').addEventListener('click',evaluateClick);
  $('exportReferenceEvaluation').addEventListener('click',()=>{
    const files=exportFiles();if(!files.length){status('음원 재분석 후 정답 비교를 다시 실행해 주세요.',true);return;}
    files.forEach(f=>download(f.blob,f.name));
    status('정답 비교 CSV 3개 저장을 요청했어요. 모바일에서 여러 파일 저장이 차단되면 전체 결과 ZIP 저장을 이용하세요.');
  });
  const invalidate=()=>{last=null;$('exportReferenceEvaluation').disabled=true;$('referenceResults').hidden=true;};
  ['referenceCapo','referenceText','referenceMode','songBpm','timeSignature','beatOffset','referenceAligned'].forEach(id=>{
    $(id).addEventListener('input',invalidate);$(id).addEventListener('change',invalidate);
  });
  // The original ZIP exporter includes these three files after a valid comparison.
  ref.getExportFiles=exportFiles;
})();
