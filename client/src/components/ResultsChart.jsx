import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const colors = ['#b9d87c', '#2f8076', '#7eaac4', '#e8ad77'];

export default function ResultsChart({ results }) {
  const rows = results.map((result, index) => ({ ...result, label: String.fromCharCode(65 + index) }));
  const maximum = Math.max(1, ...rows.map((row) => row.count));

  return (
    <div className="min-w-0">
      <div className="h-60 min-w-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart accessibilityLayer={false} data={rows} margin={{ top: 28, right: 8, bottom: 0, left: -22 }} barSize={54}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#526761', fontSize: 13 }} />
            <YAxis domain={[0, maximum]} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#78877f', fontSize: 12 }} />
            <Tooltip cursor={{ fill: '#f5f7f4' }} formatter={(value) => [value, 'Votes']} labelFormatter={(label) => `Option ${label}`} />
            <Bar dataKey="count" radius={[8, 8, 0, 0]} isAnimationActive={false}>
              {rows.map((row, index) => <Cell key={row.optionId} fill={colors[index % colors.length]} />)}
              <LabelList dataKey="count" position="top" fill="#163a3a" fontSize={13} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ol className="mt-5 space-y-3" aria-label="Results by answer">
        {rows.map((row, index) => (
          <li key={row.optionId} className="flex items-start gap-3 rounded-xl border border-[#e5ebe6] p-3 sm:p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-[#163a3a]" style={{ backgroundColor: `${colors[index % colors.length]}40` }}>{row.label}</span>
            <span className="min-w-0 flex-1 break-words pt-1 text-sm font-medium text-[#163a3a]">{row.text}</span>
            <span className="shrink-0 text-right text-sm text-[#163a3a]">
              <span className="block font-semibold">{row.count} {row.count === 1 ? 'vote' : 'votes'}</span>
              <span className="muted text-xs">{row.percentage.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
