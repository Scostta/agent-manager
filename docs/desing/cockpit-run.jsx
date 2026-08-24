// Run Console — live streaming simulation
const { useState, useEffect, useRef } = React;

const TOOL_ICONS = { bash: 'bash', readFile: 'readFile', editFile: 'editFile', default: 'terminal' };
const TOOL_COLORS = { bash: 'var(--orange)', readFile: 'var(--blue)', editFile: 'var(--accent)', default: 'var(--text-3)' };

function RunConsole({ task, agents, onClose }) {
  const agent = agents.find(a => a.id === task.agentId) || agents[0];
  const { STREAM_EVENTS } = window.MOCK_DATA;

  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('running'); // running | done | cancelled
  const [elapsed, setElapsed] = useState(0);
  const [metrics, setMetrics] = useState({ input: task.activeRun?.tokens?.input || 4200, output: task.activeRun?.tokens?.output || 820, cache: task.activeRun?.tokens?.cache || 2100, cost: task.activeRun?.cost || 0.12 });
  const [eventIdx, setEventIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const logRef = useRef(null);
  const startTime = useRef(Date.now());

  // Timer
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 500);
    return () => clearInterval(iv);
  }, []);

  // Stream events
  useEffect(() => {
    if (status !== 'running') return;
    if (eventIdx >= STREAM_EVENTS.length) {
      setTimeout(() => setStatus('done'), 800);
      return;
    }
    const delay = STREAM_EVENTS[eventIdx].type === 'tool' ? 900 : 1400;
    const t = setTimeout(() => {
      setEvents(ev => [...ev, { ...STREAM_EVENTS[eventIdx], id: Date.now() }]);
      setEventIdx(i => i + 1);
      // Update metrics
      const deltaIn = Math.floor(Math.random() * 300) + 100;
      const deltaOut = Math.floor(Math.random() * 120) + 40;
      setMetrics(m => ({ input: m.input + deltaIn, output: m.output + deltaOut, cache: m.cache + Math.floor(deltaIn * 0.6), cost: m.cost + (deltaIn + deltaOut) * 0.0000035 }));
    }, delay);
    return () => clearTimeout(t);
  }, [eventIdx, status]);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  function formatDur(s) {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s/60)}m ${s%60}s`;
  }

  const panelStyle = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 800, display: 'flex', flexDirection: 'column' }
    : { width: 400, borderLeft: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 };

  return (
    <div style={{ ...panelStyle, background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-1)', flexShrink: 0, background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {status === 'running' ? <StatusDot status="running" pulse /> : <StatusDot status={status === 'done' ? 'done' : 'error'} />}
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }} className="truncate">{task.title}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => setFullscreen(f => !f)} style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
              <Icon name="expand" size={13} />
            </button>
            <button onClick={onClose} style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>

        {/* Agent + model */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {agent && <AgentAvatar name={agent.name} size={20} color={agent.color} />}
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{agent?.name}</span>
          <Badge variant="default" size="xs">{agent?.model}</Badge>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="clock" size={10} />{formatDur(elapsed)}
          </span>
        </div>

        {/* Live metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { label: 'Input', value: metrics.input, fmt: v => fmtTok(v) },
            { label: 'Output', value: metrics.output, fmt: v => fmtTok(v) },
            { label: 'Cache', value: metrics.cache, fmt: v => fmtTok(v) },
            { label: 'Cost', value: metrics.cost, fmt: v => `$${v.toFixed(3)}` },
          ].map(({ label, value, fmt }) => (
            <div key={label} style={{ background: 'var(--bg-3)', borderRadius: 'var(--r-sm)', padding: '5px 7px', border: '1px solid var(--border-1)' }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
              <MetricValue value={fmt(value)} style={{ fontSize: 12 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Event stream */}
      <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 0', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6 }}>
        {events.map((ev, i) => (
          <EventRow key={ev.id || i} event={ev} />
        ))}
        {status === 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px' }}>
            <Spinner size={11} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>processing…</span>
          </div>
        )}
        {status === 'done' && (
          <div className="fade-in" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginTop: 4, borderTop: '1px solid var(--border-1)' }}>
            <Icon name="check" size={12} style={{ color: 'var(--green)' }} />
            <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 500 }}>Run completed</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 4 }}>in {formatDur(elapsed)}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 8, flexShrink: 0, background: 'var(--bg-2)' }}>
        {status === 'running' ? (
          <Button variant="danger" size="sm" icon="stop" onClick={() => setStatus('cancelled')} style={{ flex: 1 }}>Cancel run</Button>
        ) : (
          <>
            <Button variant="default" size="sm" icon="refresh" style={{ flex: 1 }} onClick={() => { setEvents([]); setEventIdx(0); setStatus('running'); setMetrics({ input: 0, output: 0, cache: 0, cost: 0 }); startTime.current = Date.now(); }}>Re-run</Button>
            <Button variant="ghost" size="sm" icon="eye">View files</Button>
          </>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const isText = event.type === 'text';
  const isTool = event.type === 'tool';
  const [expanded, setExpanded] = useState(false);

  if (isText) return (
    <div style={{ padding: '4px 14px', display: 'flex', gap: 10 }}>
      <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>›</span>
      <span style={{ color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.5 }}>{event.content}</span>
    </div>
  );

  if (isTool) {
    const icon = TOOL_ICONS[event.tool] || TOOL_ICONS.default;
    const color = TOOL_COLORS[event.tool] || TOOL_COLORS.default;
    return (
      <div style={{ padding: '3px 14px' }}>
        <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '3px 0' }}>
          <span style={{ width: 20, height: 20, borderRadius: 'var(--r-sm)', background: 'var(--bg-4)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={icon} size={11} style={{ color }} />
          </span>
          <span style={{ color, fontSize: 11, fontWeight: 600 }}>{event.tool}</span>
          <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{event.content}</span>
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={10} style={{ color: 'var(--text-3)', marginLeft: 'auto' }} />
        </div>
        {expanded && event.result && (
          <div style={{ marginLeft: 27, marginTop: 3, padding: '6px 8px', background: 'var(--bg-3)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-1)', color: 'var(--text-3)', fontSize: 10, whiteSpace: 'pre-wrap' }}>
            {event.result}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '3px 14px', color: 'var(--red)', fontSize: 11 }}>
      <Icon name="alertCircle" size={11} /> {event.content}
    </div>
  );
}

function fmtTok(n) {
  if (n >= 1000000) return `${(n/1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`;
  return `${n}`;
}

Object.assign(window, { RunConsole });
