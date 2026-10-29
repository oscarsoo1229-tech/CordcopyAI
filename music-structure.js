/* ChordLens musical-grid refinement. No external dependencies. */
(function (root) {
  'use strict';
  function refine(segments, settings, duration) {
    if (!Array.isArray(segments) || !segments.length) return [];
    const bpm = Number(settings && settings.bpm);
    const beats = Number(settings && settings.beats);
    const offset = Number(settings && settings.offset) || 0;
    if (!(bpm >= 40 && bpm <= 240) || ![2, 3, 4, 6].includes(beats)) return segments.map(x => ({...x}));
    const beat = 60 / bpm * (beats === 6 ? .5 : 1);
    const grid = beat / 2; // half-beat allows mid-measure changes
    const maxShift = Math.min(.18, grid * .28);
    const out = segments.map(x => ({...x}));
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1], curr = out[i];
      if (prev.chord === 'N' || curr.chord === 'N') continue;
      const boundary = curr.start;
      const nearest = offset + Math.round((boundary - offset) / grid) * grid;
      if (Math.abs(nearest - boundary) <= maxShift &&
          nearest - prev.start >= .16 && curr.end - nearest >= .16) {
        prev.end = nearest;
        curr.start = nearest;
      }
    }
    const merged = [];
    for (const s of out) {
      const last = merged[merged.length - 1];
      if (last && last.chord === s.chord && Math.abs(last.end - s.start) < .05) {
        const d1 = last.end - last.start, d2 = s.end - s.start;
        last.confidence = (last.confidence * d1 + s.confidence * d2) / Math.max(.001, d1 + d2);
        last.end = s.end;
      } else merged.push(s);
    }
    return merged.filter(s => s.end > s.start && s.start < duration);
  }
  function phrases(segments, settings, duration) {
    const bpm = Number(settings && settings.bpm);
    const beats = Number(settings && settings.beats);
    const offset = Math.max(0, Number(settings && settings.offset) || 0);
    if (!(bpm >= 40 && bpm <= 240) || ![2,3,4,6].includes(beats)) return [];
    const bar = (60 / bpm) * (beats === 6 ? .5 : 1) * beats;
    const phraseBars = 4;
    const result = [];
    for (let start = offset, i = 0; start < duration && i < 250; start += bar * phraseBars, i++) {
      const end = Math.min(duration, start + bar * phraseBars);
      const chords = [];
      for (const s of segments) {
        if (s.end <= start || s.start >= end || s.chord === 'N') continue;
        if (chords[chords.length - 1] !== s.chord) chords.push(s.chord);
      }
      result.push({number:i+1, start, end, chords, label:`구간 ${i+1}`});
    }
    // Phrase blocks are grid-based, not verified verse/chorus labels.
    return result;
  }
  root.ChordLensStructure = Object.freeze({refine, phrases});
})(typeof window !== 'undefined' ? window : globalThis);
