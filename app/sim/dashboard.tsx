'use client';

// Act 1 dashboard: play back one simulated campaign tick by tick. Two charts
// share the time axis (no dual axis): verified users against the goal, and the
// price per sign-up. Hover or arrow keys read every series at one time; the
// table view carries the same numbers without hovering. ALL DATA IS SYNTHETIC.

import {useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import type {DashboardData, LogItem, Point, Series} from '@/sim/dashboard-data';
import styles from './dashboard.module.css';

const money = (cents: number, digits = 2) => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
const dayLabel = (h: number) => `Day ${(h / 24).toFixed(h % 24 ? 1 : 0)}`;
const SERIES_CLASS = [styles.s1, styles.s2];
const SPEEDS = [1, 2, 4];

export function Dashboard({data}: {data: DashboardData}) {
  const primary = data.series[0];
  const last = primary.points.length - 1;
  const [idx, setIdx] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIdx(i => {
        if (i >= last) { setPlaying(false); return last; }
        return i + 1;
      });
    }, 500 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, last]);

  const play = () => {
    if (idx >= last) setIdx(0);
    setPlaying(p => !p);
  };

  const now = primary.points[idx];
  const shownIdx = hover !== null && hover <= idx ? hover : idx;
  const goal = data.brief.goalCount;
  const usersRaw = Math.max(goal, ...data.series.flatMap(s => s.points.map(p => p.users))) * 1.08;
  const {max: usersMax, ticks: usersTicks} = niceScale(usersRaw);
  const usersScale = {yMax: usersMax, yTicksCount: usersTicks};
  const hoursTotal = data.brief.days * 24;

  return (
    <div className={styles.root}>
      <header className={styles.top}>
        <a href="/sim" className={styles.brand} aria-label="Dealoop"><img src="/brand/dealoop-wordmark.png" alt="Dealoop" width={2048} height={682} /></a>
        <span className={styles.act}>Act 1 · Scale</span>
      </header>

      <main className={styles.main}>
        <p className={styles.synthetic} role="note"><strong>Synthetic data.</strong> The creators and their audiences are generated. {data.source === 'claude' ? 'The agents’ decisions are real Claude model calls, recorded earlier; nothing here calls the API.' : 'No model calls are involved.'}</p>

        <div className={styles.heading}>
          <div>
            <h1>{data.title}</h1>
            <p className={styles.subtitle}>{data.subtitle}</p>
          </div>
          <form method="get" className={styles.picker}>
            <label htmlFor="run">Run</label>
            <select id="run" name="run" defaultValue={data.selected} onChange={e => e.currentTarget.form?.requestSubmit()}>
              {data.runs.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <noscript><button type="submit">Load</button></noscript>
          </form>
        </div>

        <ul className={styles.brief} aria-label="Campaign brief">
          <li><span>Goal</span>{goal} sign-ups</li>
          <li><span>Budget</span>{money(data.brief.budgetCents, 0)}</li>
          <li><span>Max CAC</span>{money(data.brief.maxCacCents, 0)}</li>
          <li><span>Deadline</span>{data.brief.days} days</li>
          <li><span>Creators</span>{data.market.creators}</li>
          {data.models && <li><span>Agents</span>{data.models.founder === data.models.creator ? data.models.founder : `${data.models.founder} / ${data.models.creator}`}</li>}
          {data.usage && <li><span>API</span>{data.usage.calls} calls{data.usage.costUsd !== null ? `, about $${data.usage.costUsd.toFixed(2)}` : ''}</li>}
        </ul>

        <div className={styles.controls}>
          <button type="button" className={styles.play} onClick={play} aria-pressed={playing}>
            {playing ? 'Pause' : idx >= last ? 'Replay' : 'Play'}
          </button>
          <div className={styles.speeds} role="group" aria-label="Playback speed">
            {SPEEDS.map(s => <button key={s} type="button" aria-pressed={speed === s} className={speed === s ? styles.on : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <input className={styles.scrub} type="range" min={0} max={last} value={idx} aria-label="Campaign time"
            onChange={e => { setPlaying(false); setIdx(Number(e.target.value)); }} />
          <span className={styles.clock}>{dayLabel(now.h)} <span>of {data.brief.days}</span></span>
        </div>

        <section className={styles.kpis} aria-label="At this point in the campaign">
          <Kpi label="Verified sign-ups" value={String(now.users)} note={now.users >= goal ? `Goal of ${goal} met` : `Goal ${goal}`} good={now.users >= goal} />
          <Kpi label="Price per sign-up" value={money(now.priceCents)} note="Paid to every creator, retroactively" />
          <Kpi label="Budget committed" value={money(now.committedCents, 0)} note={`${Math.round(100 * now.committedCents / data.brief.budgetCents)}% of ${money(data.brief.budgetCents, 0)}`} meter={now.committedCents / data.brief.budgetCents} />
          <Kpi label="Creators promoting now" value={`${now.activeCreators}`} note={`of ${data.market.creators}; a creator stops when their audience is used up`} />
        </section>

        <div className={styles.grid}>
          <div className={styles.charts}>
            <Legend series={data.series} />
            <Chart
              title="Verified sign-ups"
              series={data.series} idx={idx} hover={hover} setHover={setHover}
              value={p => p.users} format={v => String(v)} hoursTotal={hoursTotal}
              {...usersScale}
              reference={{value: goal, label: `Goal ${goal}`}}
            />
            <Chart
              title="Price per sign-up"
              series={data.series} idx={idx} hover={hover} setHover={setHover}
              value={p => p.priceCents} format={v => money(v)} step hoursTotal={hoursTotal}
              yMax={data.brief.maxCacCents} yTicksCount={5}
              reference={{value: data.brief.maxCacCents, label: `Max CAC ${money(data.brief.maxCacCents, 0)}`}}
            />
            <button type="button" className={styles.linkButton} onClick={() => setShowTable(t => !t)} aria-expanded={showTable}>
              {showTable ? 'Hide' : 'Show'} the numbers as a table
            </button>
            {showTable && <DataTable series={data.series} upTo={idx} />}
          </div>

          <Feed log={data.log} upToHour={primary.points[shownIdx].h} creators={data.creators} source={data.source} />
        </div>

        <section className={styles.outcomes} aria-labelledby="outcomes-title">
          <h2 id="outcomes-title">How it ended, against fixed prices</h2>
          <p className={styles.note}>{data.supplyNote}</p>
          <table>
            <thead><tr><th scope="col">Strategy</th><th scope="col">Sign-ups</th><th scope="col">Avg CAC</th><th scope="col">Spent</th><th scope="col">Final price</th></tr></thead>
            <tbody>
              {data.outcomes.map(o => (
                <tr key={o.label} className={o.highlight ? styles.highlight : ''}>
                  <th scope="row">{o.label}</th><td>{o.users}</td><td>{o.users ? money(o.avgCacCents) : '—'}</td><td>{money(o.spendCents, 0)}</td><td>{money(o.finalPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function Kpi({label, value, note, good, meter}: {label: string; value: string; note: string; good?: boolean; meter?: number}) {
  return (
    <div className={styles.kpi}>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
      {meter !== undefined && <div className={styles.meter} aria-hidden="true"><span style={{width: `${Math.min(100, meter * 100)}%`}} /></div>}
      <p className={good ? styles.kpiGood : styles.kpiNote}>{good && <span aria-hidden="true">✓ </span>}{note}</p>
    </div>
  );
}

function Legend({series}: {series: Series[]}) {
  return (
    <ul className={styles.legend} aria-label="Series">
      {series.map((s, i) => <li key={s.key}><svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" className={SERIES_CLASS[i]} strokeWidth="2" strokeLinecap="round" /></svg>{s.label}</li>)}
    </ul>
  );
}

/** A rounded axis maximum and a tick count whose step is a round number (1, 2, 2.5 or 5 × 10^k). */
function niceScale(raw: number, target = 4) {
  const rough = Math.max(1, raw) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = ([1, 2, 2.5, 5, 10].find(c => rough / mag <= c) ?? 10) * mag;
  const max = Math.ceil(Math.max(1, raw) / step) * step;
  return {max, ticks: Math.round(max / step)};
}

const W = 640, H = 232, M = {l: 48, r: 64, t: 14, b: 30};
const PW = W - M.l - M.r, PH = H - M.t - M.b;

interface ChartProps {
  title: string;
  series: Series[];
  idx: number;
  hover: number | null;
  setHover: (i: number | null) => void;
  value: (p: Point) => number;
  format: (v: number) => string;
  yMax: number;
  yTicksCount?: number;
  hoursTotal: number;
  step?: boolean;
  reference?: {value: number; label: string};
}

function Chart({title, series, idx, hover, setHover, value, format, yMax, yTicksCount = 4, hoursTotal, step, reference}: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const x = (h: number) => M.l + (h / hoursTotal) * PW;
  const y = (v: number) => M.t + PH - (v / yMax) * PH;
  const hours = series[0].points.map(p => p.h);

  const paths = useMemo(() => series.map(s => {
    const pts = s.points.slice(0, idx + 1);
    if (!pts.length) return '';
    let d = `M${x(pts[0].h)},${y(value(pts[0]))}`;
    for (let i = 1; i < pts.length; i++) {
      d += step ? `H${x(pts[i].h)}V${y(value(pts[i]))}` : `L${x(pts[i].h)},${y(value(pts[i]))}`;
    }
    return d;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [series, idx, yMax, step]);

  const ticks = Array.from({length: yTicksCount + 1}, (_, i) => (yMax / yTicksCount) * i);
  const dayTicks = Array.from({length: Math.floor(hoursTotal / 48) + 1}, (_, i) => i * 48);

  const nearest = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const hx = ((clientX - rect.left) / rect.width * W - M.l) / PW * hoursTotal;
    let best = 0;
    for (let i = 0; i <= idx; i++) if (Math.abs(hours[i] - hx) < Math.abs(hours[best] - hx)) best = i;
    return best;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(nearest(e.clientX));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover ?? idx;
    setHover(Math.max(0, Math.min(idx, cur + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  const at = hover !== null && hover <= idx ? hover : null;
  const tipLeft = at !== null ? (x(hours[at]) / W) * 100 : 0;

  return (
    <figure className={styles.chart}>
      <figcaption>{title}</figcaption>
      <div className={styles.plotWrap}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
          aria-label={`${title} over ${hoursTotal / 24} days. Use the left and right arrow keys to read values; the table view lists every value.`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.l} x2={M.l + PW} y1={y(t)} y2={y(t)} className={t === 0 ? styles.baseline : styles.gridline} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className={styles.tick}>{format(t)}</text>
            </g>
          ))}
          {dayTicks.map(h => <text key={h} x={x(h)} y={H - 8} textAnchor="middle" className={styles.tick}>{h === 0 ? 'Day 0' : h / 24}</text>)}
          {reference && (
            <g>
              {reference.value < yMax && <line x1={M.l} x2={M.l + PW} y1={y(reference.value)} y2={y(reference.value)} className={styles.reference} />}
              <text x={M.l + 6} y={y(reference.value) - 6} className={styles.refLabel}>{reference.label}</text>
            </g>
          )}
          {/* Paint the comparison first so the run being played back stays on top. */}
          {paths.map((d, i) => ({d, i})).reverse().map(({d, i}) => <path key={series[i].key} d={d} className={`${styles.line} ${SERIES_CLASS[i]}`} />)}
          {series.map((s, i) => ({s, i})).reverse().map(({s, i}) => {
            const p = s.points[Math.min(idx, s.points.length - 1)];
            return <circle key={s.key} cx={x(p.h)} cy={y(value(p))} r={4} className={`${styles.dot} ${SERIES_CLASS[i]}`} />;
          })}
          {endLabels(series, idx, value, y).map(l => (
            <text key={l.key} x={Math.min(x(l.h), M.l + PW) + 8} y={l.y} dy="0.32em" className={styles.endLabel}>{format(l.v)}</text>
          ))}
          {at !== null && <line x1={x(hours[at])} x2={x(hours[at])} y1={M.t} y2={M.t + PH} className={styles.crosshair} />}
          <rect x={M.l} y={M.t} width={PW} height={PH} fill="transparent" />
        </svg>
        {at !== null && (
          <div className={styles.tooltip} style={{left: `${tipLeft}%`}} role="status">
            <p className={styles.tipTime}>{dayLabel(hours[at])}</p>
            {series.map((s, i) => (
              <p key={s.key} className={styles.tipRow}>
                <svg width="12" height="6" aria-hidden="true"><line x1="1" y1="3" x2="11" y2="3" className={SERIES_CLASS[i]} strokeWidth="2" strokeLinecap="round" /></svg>
                <strong>{format(value(s.points[at]))}</strong><span>{s.label}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Direct labels at the line ends: one label when values match, pushed apart when they would collide. */
function endLabels(series: Series[], idx: number, value: (p: Point) => number, y: (v: number) => number) {
  const ends = series.map(s => {
    const p = s.points[Math.min(idx, s.points.length - 1)];
    return {key: s.key, h: p.h, v: value(p), y: y(value(p))};
  });
  if (ends.length === 2 && ends[0].v === ends[1].v) return [ends[0]];
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
    const [hi, lo] = ends[0].y <= ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const mid = (hi.y + lo.y) / 2;
    hi.y = mid - 7;
    lo.y = mid + 7;
  }
  return ends;
}

function DataTable({series, upTo}: {series: Series[]; upTo: number}) {
  const rows = series[0].points.slice(0, upTo + 1);
  return (
    <div className={styles.tableWrap}>
      <table>
        <caption>Every 6-hour tick, up to the playhead</caption>
        <thead>
          <tr><th scope="col">Time</th>{series.map(s => <th key={s.key} scope="col">{s.label}: sign-ups</th>)}{series.map(s => <th key={s.key + 'p'} scope="col">{s.label}: price</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.h}><th scope="row">{dayLabel(p.h)}</th>{series.map(s => <td key={s.key}>{s.points[i]?.users ?? '—'}</td>)}{series.map(s => <td key={s.key + 'p'}>{s.points[i] ? money(s.points[i].priceCents) : '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FeedFilter = 'all' | 'founder' | 'join' | 'decline';
const FILTERS: {value: FeedFilter; label: string}[] = [
  {value: 'all', label: 'All'}, {value: 'founder', label: 'Founder'}, {value: 'join', label: 'Joined'}, {value: 'decline', label: 'Declined'},
];

function Feed({log, upToHour, creators, source}: {log: LogItem[]; upToHour: number; creators: DashboardData['creators']; source: DashboardData['source']}) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const shown = log.filter(e => e.h <= upToHour);
  const holds = shown.filter(e => e.kind === 'hold');
  const items = shown
    .filter(e => e.kind !== 'hold')
    .filter(e => filter === 'all' || (filter === 'founder' ? e.actor === 'founder' : e.kind === filter))
    .slice().reverse();
  const lastHold = filter === 'all' || filter === 'founder' ? holds.at(-1) : undefined;
  const countOf = (f: FeedFilter) => f === 'all' ? shown.filter(e => e.kind !== 'hold').length : f === 'founder' ? shown.filter(e => e.actor === 'founder' && e.kind !== 'hold').length : shown.filter(e => e.kind === f).length;
  return (
    <aside className={styles.feed} aria-label="Agent decisions">
      <h2>What the agents decided</h2>
      <p className={styles.note}>{source === 'claude' ? 'Each entry is a Claude agent’s own words. The founder agent forecasts; the core decides.' : 'Rule-based decisions; no model calls.'}</p>
      <div className={styles.filters} role="group" aria-label="Show">
        {FILTERS.map(f => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} className={filter === f.value ? styles.on : ''} onClick={() => setFilter(f.value)}>
            {f.label} <span>{countOf(f.value)}</span>
          </button>
        ))}
      </div>
      {lastHold && (
        <div className={`${styles.item} ${styles.hold}`}>
          <p className={styles.itemHead}><span className={styles.badge}>Price held</span><span>{holds.length} time{holds.length === 1 ? '' : 's'} so far · latest {dayLabel(lastHold.h)}</span></p>
          <p className={styles.itemText}>{lastHold.text}</p>
        </div>
      )}
      <ol className={styles.items}>
        {items.map((e, i) => {
          const c = creators[e.actor];
          const who = e.actor === 'founder' ? 'Founder agent' : c ? `${c.handle} · ${c.niche} · ${c.platform}` : e.actor;
          const badge = e.kind === 'raise' ? 'Raised price' : e.kind === 'join' ? 'Joined' : 'Declined';
          return (
            <li key={`${e.h}-${e.actor}-${i}`} className={`${styles.item} ${styles[e.kind]}`}>
              <p className={styles.itemHead}><span className={styles.badge}>{badge}</span><span>{dayLabel(e.h)} · {who}</span></p>
              <p className={styles.itemText}>{e.text}{e.fellBack ? ' (fallback rule used)' : ''}</p>
            </li>
          );
        })}
      </ol>
      {!items.length && !lastHold && <p className={styles.note}>Nothing yet. Press Play.</p>}
    </aside>
  );
}
