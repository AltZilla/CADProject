import React from 'react';

export default function Badge({ confidence }: { confidence: number }) {
  let level = 'low';
  let color = 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50';
  
  if (confidence > 70) {
    level = 'high';
    color = 'bg-green-500/20 text-green-500 border-green-500/50';
  } else if (confidence > 40) {
    level = 'nominal';
    color = 'bg-blue-500/20 text-blue-400 border-blue-500/50';
  }

  return (
    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {level}
    </span>
  );
}
