import React from 'react';

const scoreToColor = (score) => {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return 'bg-slate-200 border-slate-300 text-slate-500';
  }
  if (score >= 0.8) return 'bg-emerald-500 border-emerald-600 text-white';
  if (score >= 0.6) return 'bg-amber-500 border-amber-600 text-white';
  return 'bg-rose-500 border-rose-600 text-white';
};

const formatScore = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(2);
};

const ParagraphScoreDots = ({ scores = {}, labels = [] }) => {
  return (
  <div className="flex flex-col items-center gap-1 isolate" aria-label="Paragraph AI scores">
      {labels.map((label) => {
        const value = scores?.[label.key];
        return (
          <div
            key={label.key}
            className="group relative flex items-center justify-center my-0 z-0 group-hover:z-[999] group-hover:my-3 transition-all duration-200"
            title={`${label.label}: ${formatScore(value)}`}
          >
            {/* Small colored circle (no number) - zooms dramatically on hover and shows number at readable size */}
            <div
              className={`h-2.5 w-2.5 rounded-full border shadow-sm flex items-center justify-center transition-all duration-200 ease-out group-hover:scale-[5] group-hover:shadow-2xl group-hover:border-2 group-hover:z-[999] ${scoreToColor(
                value
              )}`}
            >
              <span className="select-none pointer-events-none leading-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[2px] group-hover:text-[2px] font-bold">{formatScore(value)}</span>
            </div>
            {/* Side label - stays same size for readability */}
            <div className="pointer-events-none absolute right-full mr-4 opacity-0 transition-all duration-200 ease-out group-hover:-translate-x-4 group-hover:opacity-100 z-[999] whitespace-nowrap text-base font-semibold text-slate-800 drop-shadow-lg">
              {label.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ParagraphScoreDots;
