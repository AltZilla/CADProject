import React from 'react';

interface SliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit: string;
  formatValue?: (v: number) => string;
}

export default function Slider({ min, max, step, value, onChange, label, formatValue }: SliderProps) {
  const displayValue = formatValue ? formatValue(value) : value.toString();
  
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="text-xs font-medium text-slate-200">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-500"
      />
    </div>
  );
}
