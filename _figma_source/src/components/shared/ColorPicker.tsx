import { PRESET_COLORS } from '@/lib/format'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
}

export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          className={`w-7 h-7 rounded-lg border-2 transition-all ${
            value === color
              ? 'border-slate-800 scale-110 shadow-sm'
              : 'border-transparent hover:scale-105'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  )
}
