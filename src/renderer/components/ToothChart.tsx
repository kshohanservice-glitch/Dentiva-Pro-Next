import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ChartState, ToothConditionDTO } from '../../shared/types';
import { Button, Spinner, useToast } from './primitives';
import { CONDITION_KEYS, conditionLabel } from '../../shared/clinical';

/* FDI notation charts. Adult: 32 permanent teeth, pediatric: 20 primary. */

const ADULT = [
  { q: 'Upper right', teeth: [18, 17, 16, 15, 14, 13, 12, 11] },
  { q: 'Upper left', teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
  { q: 'Lower left', teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
  { q: 'Lower right', teeth: [41, 42, 43, 44, 45, 46, 47, 48] },
];

const PEDIATRIC = [
  { q: 'Upper right', teeth: [55, 54, 53, 52, 51] },
  { q: 'Upper left', teeth: [61, 62, 63, 64, 65] },
  { q: 'Lower left', teeth: [71, 72, 73, 74, 75] },
  { q: 'Lower right', teeth: [81, 82, 83, 84, 85] },
];

const LEGEND_COLORS: Record<string, string> = {
  caries: '#B42318', restored: '#175CD3', missing: '#475467', root_canal: '#7A5AF8',
  crown: '#0E7C86', bridge: '#084B63', implant: '#344054', fracture: '#DC6803',
  extraction_needed: '#D92D20', abscess: '#912018', periodontal: '#1E7A4B', mobility: '#B26B00',
};

const SURFACES = [
  { key: 'M', label: 'Mesial', pos: { left: 4, top: '50%', transform: 'translateY(-50%)' } },
  { key: 'D', label: 'Distal', pos: { right: 4, top: '50%', transform: 'translateY(-50%)' } },
  { key: 'B', label: 'Buccal', pos: { top: 4, left: '50%', transform: 'translateX(-50%)' } },
  { key: 'L', label: 'Lingual', pos: { bottom: 4, left: '50%', transform: 'translateX(-50%)' } },
];

interface Selection { tooth: string; surface?: string }

export function ToothChart(props: {
  patientId: number;
  visitId?: number | null;
  editable?: boolean;
  dentition?: 'permanent' | 'mixed' | 'primary';
  height?: number;
}) {
  const { patientId, editable = false } = props;
  const [chart, setChart] = useState<ChartState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dentition, setDentition] = useState<'adult' | 'pediatric'>('adult');
  const [condition, setCondition] = useState<string>(CONDITION_KEYS[0]);
  const [severity, setSeverity] = useState<string>('mild');
  const [selection, setSelection] = useState<Selection[]>([]);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    setError(null);
    api['chart/get'](patientId)
      .then(setChart)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chart'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [patientId]);

  useEffect(() => {
    if (props.dentition) setDentition(props.dentition === 'primary' ? 'pediatric' : 'adult');
  }, [props.dentition]);

  const currentByTooth = useMemo(() => {
    const map = new Map<string, ToothConditionDTO[]>();
    for (const c of chart?.current ?? []) {
      const arr = map.get(c.tooth) ?? [];
      arr.push(c);
      map.set(c.tooth, arr);
    }
    return map;
  }, [chart]);

  const toggleTooth = (tooth: string, surface?: string): void => {
    setSelection((sel) => {
      const exists = sel.find((s) => s.tooth === tooth && s.surface === surface);
      if (exists) return sel.filter((s) => s !== exists);
      // single tooth replaces the previous whole-tooth pick for clarity
      return [...sel.filter((s) => s.tooth !== tooth || surface !== undefined), { tooth, surface }];
    });
  };

  const clearSelection = (): void => setSelection([]);

  const apply = async (): Promise<void> => {
    if (selection.length === 0) return;
    setPending(true);
    try {
      const changes = selection.map((s) => ({
        tooth: s.tooth,
        condition: condition,
        severity: severity,
        note: s.surface ? `surface:${s.surface}` : null,
        action: 'set' as const,
      }));
      const next = await api['chart/set']({ patientId, visitId: props.visitId ?? null, changes });
      setChart(next);
      setSelection([]);
      toast.success('Chart updated', `${changes.length} tooth/teeth marked as ${conditionLabel(condition)}.`);
    } catch (err) {
      toast.error('Chart update failed', err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const clearMark = async (tooth: string): Promise<void> => {
    if (!editable) return;
    setPending(true);
    try {
      const changes = (currentByTooth.get(tooth) ?? []).map((c) => ({
        tooth, condition: c.condition, action: 'clear' as const,
      }));
      if (changes.length === 0) return;
      const next = await api['chart/set']({ patientId, visitId: props.visitId ?? null, changes });
      setChart(next);
      toast.success(`Tooth ${tooth} cleared`);
    } catch (err) {
      toast.error('Failed to clear', err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  if (loading) return <Spinner label="Loading dental chart…" />;
  if (error) return <div className="alert alert-danger">{error}</div>;

  const quadrants = dentition === 'adult' ? ADULT : PEDIATRIC;

  const toothColor = (tooth: string): { bg: string; fg: string } => {
    const marks = currentByTooth.get(tooth) ?? [];
    if (marks.length === 0) return { bg: 'var(--surface-2)', fg: 'var(--text-1)' };
    const first = marks[0];
    const map = LEGEND_COLORS;
    const bg = map[first.condition] ?? '#0ea5e9';
    return { bg, fg: ['#111827', '#ca8a04'].includes(bg) ? '#111' : '#fff' };
  };

  const selectedLabel =
    selection.length === 0
      ? 'Click teeth (or individual surfaces) to select'
      : selection.map((s) => `${s.tooth}${s.surface ? `-${s.surface}` : ''}`).join(', ');

  return (
    <div className="tooth-chart" style={props.height ? { height: props.height } : undefined}>
      <div className="chart-toolbar">
        <div className="row gap-2 wrap">
          <div className="seg" role="tablist" aria-label="Dentition">
            <button className={dentition === 'adult' ? 'active' : ''} onClick={() => setDentition('adult')} type="button">Adult (FDI)</button>
            <button className={dentition === 'pediatric' ? 'active' : ''} onClick={() => setDentition('pediatric')} type="button">Pediatric</button>
          </div>
          {editable && (
            <>
              <select className="select" style={{ width: 200 }} value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="Condition">
                {CONDITION_KEYS.map((k) => <option key={k} value={k}>{conditionLabel(k)}</option>)}
              </select>
              <select className="select" style={{ width: 120 }} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </>
          )}
        </div>
        <div className="row gap-2 wrap">
          <span className="xsmall muted">{selectedLabel}</span>
          {editable && (
            <>
              <Button size="sm" variant="secondary" onClick={clearSelection} disabled={selection.length === 0}>Clear selection</Button>
              <Button size="sm" variant="primary" loading={pending} disabled={selection.length === 0} onClick={() => void apply()}>
                Apply “{conditionLabel(condition)}”
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="chart-quadrants">
        {quadrants.map((quad, qi) => (
          <div className={`quadrant q${qi + 1}`} key={quad.q}>
            <div className="quad-label">{quad.q}</div>
            <div className="teeth-row">
              {quad.teeth.map((t) => {
                const tooth = String(t);
                const marks = currentByTooth.get(tooth) ?? [];
                const sel = selection.some((s) => s.tooth === tooth && !s.surface);
                const color = toothColor(tooth);
                return (
                  <div className="tooth" key={t}>
                    <button
                      type="button"
                      className={`tooth-body ${sel ? 'selected' : ''} ${marks.length ? 'marked' : ''}`}
                      style={marks.length ? { background: color.bg, color: color.fg } : undefined}
                      onClick={() => toggleTooth(tooth)}
                      onDoubleClick={() => editable && void clearMark(tooth)}
                      title={
                        marks.length
                          ? `Tooth ${tooth}: ${marks.map((m) => m.label).join(', ')} (double-click to clear)`
                          : `Tooth ${tooth} — click to select`
                      }
                      aria-pressed={sel}
                    >
                      <span className="tooth-num">{tooth}</span>
                      {marks.length > 0 && <span className="tooth-flag">●</span>}
                    </button>
                    <div className="tooth-surfaces">
                      {SURFACES.map((sf) => {
                        const sSel = selection.some((s) => s.tooth === tooth && s.surface === sf.key);
                        const surfaceMark = marks.find((m) => m.note === `surface:${sf.key}`);
                        return (
                          <button
                            key={sf.key}
                            type="button"
                            className={`surface ${sSel ? 'selected' : ''}`}
                            style={surfaceMark ? { background: color.bg, color: color.fg } : undefined}
                            title={`${sf.label} of ${tooth}${surfaceMark ? ` — ${surfaceMark.label}` : ''}`}
                            aria-pressed={sSel}
                            onClick={() => toggleTooth(tooth, sf.key)}
                          >
                            {sf.key}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="chart-legend">
        {[
          ['caries', 'Caries'], ['restored', 'Restoration'], ['missing', 'Missing'],
          ['root_canal', 'Root canal'], ['crown', 'Crown'], ['bridge', 'Bridge'],
          ['implant', 'Implant'], ['fracture', 'Fracture'], ['extraction_needed', 'Extraction needed'],
          ['abscess', 'Abscess'], ['periodontal', 'Periodontal'], ['mobility', 'Mobile'],
        ].map(([k, label]) => (
          <span key={k} className="legend-item">
            <i className="swatch" style={{ background: LEGEND_COLORS[k] }} />
            {label}
          </span>
        ))}
      </div>

      {editable && (chart?.history.length ?? 0) > 0 && (
        <details className="chart-history">
          <summary className="small muted">Chart history ({chart!.history.length} records)</summary>
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table className="table">
              <thead><tr><th>When</th><th>Tooth</th><th>Condition</th><th>Severity</th><th>Note</th></tr></thead>
              <tbody>
                {chart!.history.slice(0, 60).map((h) => (
                  <tr key={h.id} className={h.supersededAt ? 'row-muted' : ''}>
                    <td className="xsmall">{new Date(h.recordedAt).toLocaleString()}</td>
                    <td className="mono">{h.tooth}</td>
                    <td>{h.label}{h.supersededAt && <Badge2 text="superseded" />}</td>
                    <td>{h.severity ?? '—'}</td>
                    <td className="xsmall">{h.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Badge2({ text }: { text: string }) {
  return <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 10 }}>{text}</span>;
}
