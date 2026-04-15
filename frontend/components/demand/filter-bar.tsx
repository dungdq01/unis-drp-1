'use client';
import { useState } from 'react';

interface FilterBarProps {
  onFilterChange: (filters: {
    segment?: string;
    comboClass?: string;
    tetFlag?: string;
    archetype?: string;
  }) => void;
}

const SEGMENTS = ['All', 'A', 'B', 'C'];
const COMBO_CLASSES = ['All', 'SMOOTH', 'ERRATIC', 'LUMPY', 'COLD_START', 'DORMANT_SEASONAL', 'INTERMITTENT'];
const TET_OPTIONS = ['All', 'Tet only', 'Non-Tet'];

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const [segment, setSegment] = useState('All');
  const [combo, setCombo] = useState('All');
  const [tet, setTet] = useState('All');

  const handleChange = (field: string, value: string) => {
    const newSeg = field === 'segment' ? value : segment;
    const newCombo = field === 'combo' ? value : combo;
    const newTet = field === 'tet' ? value : tet;
    if (field === 'segment') setSegment(value);
    if (field === 'combo') setCombo(value);
    if (field === 'tet') setTet(value);

    onFilterChange({
      segment: newSeg === 'All' ? undefined : newSeg,
      comboClass: newCombo === 'All' ? undefined : newCombo,
      tetFlag: newTet === 'All' ? undefined : newTet === 'Tet only' ? 'Y' : newTet === 'Non-Tet' ? 'N' : undefined,
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="section-label">Filters</span>
      {/* Segment */}
      <select value={segment} onChange={e => handleChange('segment', e.target.value)}
        className="rounded-lg border border-[rgba(148,173,215,0.25)] bg-white/80 backdrop-blur px-3 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none">
        {SEGMENTS.map(s => <option key={s}>{s}</option>)}
      </select>
      {/* Combo Class */}
      <select value={combo} onChange={e => handleChange('combo', e.target.value)}
        className="rounded-lg border border-[rgba(148,173,215,0.25)] bg-white/80 backdrop-blur px-3 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none">
        {COMBO_CLASSES.map(c => <option key={c}>{c}</option>)}
      </select>
      {/* Tet */}
      <select value={tet} onChange={e => handleChange('tet', e.target.value)}
        className="rounded-lg border border-[rgba(148,173,215,0.25)] bg-white/80 backdrop-blur px-3 py-1.5 text-xs text-slate-700 focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none">
        {TET_OPTIONS.map(t => <option key={t}>{t}</option>)}
      </select>
    </div>
  );
}
