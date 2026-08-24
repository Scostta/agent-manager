// Shared primitive components for Claude Cockpit
// Exports to window for use by other scripts

const { useState, useEffect, useRef, useCallback } = React;

// ─── Icons (inline SVG wrappers) ─────────────────────────────────────────────
const ICONS = {
  folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  bot: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M12 2v4M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="5" r="1" fill="currentColor"/><line x1="8" y1="15" x2="8" y2="15"/><line x1="16" y1="15" x2="16" y2="15"/></svg>`,
  zap: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  settings: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  play: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  stop: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  chevronRight: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  chevronDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  x: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  terminal: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  pencil: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  cpu: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  dollar: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  expand: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
  clock: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  refresh: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  gitBranch: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  alertCircle: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  layers: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  activity: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  eye: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  code: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  readFile: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`,
  editFile: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  bash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 10l4 4-4 4"/><line x1="13" y1="18" x2="17" y2="18"/></svg>`,
  arrowLeft: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  save: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  link: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

function Icon({ name, size = 14, style, className }) {
  const svg = ICONS[name];
  if (!svg) return null;
  const sized = svg.replace(/width="(\d+)"/, `width="${size}"`).replace(/height="(\d+)"/, `height="${size}"`);
  return React.createElement('span', {
    className: className,
    style: { display: 'inline-flex', alignItems: 'center', flexShrink: 0, ...style },
    dangerouslySetInnerHTML: { __html: sized }
  });
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ children, variant = 'default', size = 'sm', dot = false }) {
  const variantStyles = {
    default: { background: 'var(--bg-5)', color: 'var(--text-2)', border: '1px solid var(--border-2)' },
    accent:  { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' },
    green:   { background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)' },
    red:     { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)' },
    yellow:  { background: 'var(--yellow-dim)', color: 'var(--yellow)', border: '1px solid color-mix(in srgb, var(--yellow) 25%, transparent)' },
    blue:    { background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid color-mix(in srgb, var(--blue) 25%, transparent)' },
    orange:  { background: 'var(--orange-dim)', color: 'var(--orange)', border: '1px solid color-mix(in srgb, var(--orange) 25%, transparent)' },
    ghost:   { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border-1)' },
  };
  const sizeStyles = {
    xs: { padding: '1px 5px', fontSize: '10px', fontWeight: 500, borderRadius: '3px', height: '16px' },
    sm: { padding: '1px 6px', fontSize: '11px', fontWeight: 500, borderRadius: 'var(--r-sm)', height: '18px' },
    md: { padding: '2px 8px', fontSize: '12px', fontWeight: 500, borderRadius: 'var(--r-sm)', height: '22px' },
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', ...variantStyles[variant], ...sizeStyles[size] }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />}
      {children}
    </span>
  );
}

// ─── Chip (skill tag) ─────────────────────────────────────────────────────────
function Chip({ children, active, onClick, removable, onRemove }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', fontSize: '11px', fontWeight: 500,
        borderRadius: '100px',
        background: active ? 'var(--accent-dim)' : 'var(--bg-4)',
        border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border-2)'}`,
        color: active ? 'var(--accent)' : 'var(--text-2)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 80ms',
        userSelect: 'none',
      }}
    >
      {children}
      {removable && (
        <span onClick={e => { e.stopPropagation(); onRemove?.(); }} style={{ opacity: .6, cursor: 'pointer', display: 'flex' }}>
          <Icon name="x" size={10} />
        </span>
      )}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
function Button({ children, variant = 'default', size = 'sm', icon, onClick, disabled, style: extraStyle }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: 'var(--font-sans)', fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', transition: 'all 80ms', userSelect: 'none', opacity: disabled ? .45 : 1,
    whiteSpace: 'nowrap',
  };
  const variants = {
    default: { background: 'var(--bg-4)', color: 'var(--text-1)', border: '1px solid var(--border-2)', '&:hover': {} },
    primary: { background: 'var(--accent)', color: 'white' },
    ghost:   { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
    danger:  { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)' },
    subtle:  { background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--border-1)' },
  };
  const sizes = {
    xs: { padding: '3px 8px', fontSize: '11px', borderRadius: 'var(--r-sm)', height: '24px' },
    sm: { padding: '4px 10px', fontSize: '12px', borderRadius: 'var(--r-md)', height: '28px' },
    md: { padding: '6px 14px', fontSize: '13px', borderRadius: 'var(--r-md)', height: '34px' },
    lg: { padding: '8px 18px', fontSize: '14px', borderRadius: 'var(--r-lg)', height: '40px' },
  };
  const [hovered, setHovered] = useState(false);
  const hoverBg = { default: 'var(--bg-5)', primary: 'var(--accent-hover)', ghost: 'var(--bg-3)', danger: 'var(--red-dim)', subtle: 'var(--bg-4)' };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...variants[variant], ...sizes[size], background: hovered && !disabled ? hoverBg[variant] : (variants[variant].background || 'transparent'), ...extraStyle }}
    >
      {icon && <Icon name={icon} size={size === 'xs' ? 11 : size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  );
}

// ─── Avatar (agent) ───────────────────────────────────────────────────────────
const AGENT_COLORS = ['#7B6CF6', '#3FBA6E', '#E05050', '#C9961A', '#4A9EE8', '#D9784A', '#B06CB0'];
function AgentAvatar({ name, size = 24, color }) {
  const c = color || AGENT_COLORS[Math.abs(name?.split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0) % AGENT_COLORS.length];
  const initials = name?.slice(0,2).toUpperCase() || '??';
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: c + '28', border: `1px solid ${c}60`,
      color: c, fontSize: size * 0.38, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, fontFamily: 'var(--font-sans)',
    }}>
      {initials}
    </span>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────
function StatusDot({ status, pulse }) {
  const colors = { running: 'var(--green)', done: 'var(--blue)', error: 'var(--red)', blocked: 'var(--yellow)', idle: 'var(--text-3)' };
  const c = colors[status] || colors.idle;
  return (
    <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {pulse && <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: c, opacity: .25, animation: 'pulse-dot 1.4s ease-in-out infinite' }} />}
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
    </span>
  );
}

// ─── Kbd shortcut ─────────────────────────────────────────────────────────────
function Kbd({ children }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '1px 5px', fontSize: '10px', fontFamily: 'var(--font-sans)',
      background: 'var(--bg-4)', border: '1px solid var(--border-3)',
      borderBottom: '2px solid var(--border-3)', borderRadius: 'var(--r-sm)',
      color: 'var(--text-3)', lineHeight: 1.6,
    }}>
      {children}
    </kbd>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────
function Input({ value, onChange, placeholder, prefix, mono, size = 'sm', style: extraStyle, ...rest }) {
  const sizes = {
    sm: { height: 28, fontSize: 12, padding: '0 10px' },
    md: { height: 34, fontSize: 13, padding: '0 12px' },
    lg: { height: 40, fontSize: 14, padding: '0 14px' },
  };
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...extraStyle }}>
      {prefix && <span style={{ position: 'absolute', left: 10, color: 'var(--text-3)', display: 'flex', pointerEvents: 'none' }}>{prefix}</span>}
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          width: '100%', ...sizes[size],
          paddingLeft: prefix ? 30 : sizes[size].padding.split(' ')[1],
          background: 'var(--bg-3)', border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-md)', color: 'var(--text-1)', outline: 'none',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: sizes[size].fontSize,
          transition: 'border-color 80ms',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border-2)'}
        {...rest}
      />
    </div>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────
function Divider({ label, vertical }) {
  if (vertical) return <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-1)' }} />;
  if (label) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, height: 1, background: 'var(--border-1)' }} />
      <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border-1)' }} />
    </div>
  );
  return <div style={{ height: 1, background: 'var(--border-1)' }} />;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner({ size = 14, color = 'var(--accent)' }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${color}30`,
      borderTopColor: color,
      animation: 'spin .7s linear infinite',
      display: 'inline-block',
    }} />
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'default', onDismiss }) {
  const colors = { default: 'var(--text-2)', success: 'var(--green)', error: 'var(--red)', warn: 'var(--yellow)' };
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="slide-up" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--bg-4)', border: '1px solid var(--border-2)',
      borderRadius: 'var(--r-lg)', padding: '10px 14px',
      boxShadow: 'var(--shadow-lg)', maxWidth: 340,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[type], flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--text-1)', flex: 1 }}>{message}</span>
      <span onClick={onDismiss} style={{ cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}><Icon name="x" size={11} /></span>
    </div>
  );
}

// ─── Metric number (animates on change) ──────────────────────────────────────
function MetricValue({ value, prefix = '', suffix = '', style: extraStyle }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(true);
      setDisplay(value);
      prev.current = value;
      setTimeout(() => setFlash(false), 400);
    }
  }, [value]);
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontWeight: 600,
      transition: 'color 200ms',
      color: flash ? 'var(--accent)' : 'var(--text-1)',
      ...extraStyle
    }}>
      {prefix}{display}{suffix}
    </span>
  );
}

// Export all to window
Object.assign(window, {
  Icon, ICONS,
  Badge, Chip, Button, AgentAvatar, StatusDot, Kbd, Input, Divider, Spinner, Toast, MetricValue,
  AGENT_COLORS,
});
