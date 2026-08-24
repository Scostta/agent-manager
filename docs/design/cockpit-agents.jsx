// Agents list + Agent Editor with Skill Picker
const { useState } = React;

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-5',   label: 'Claude Opus 4.5',   note: 'Most capable' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', note: 'Balanced' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  note: 'Fast & cheap' },
];

function AgentCard({ agent, onClick, tasks }) {
  const runCount = tasks.filter(t => t.agentId === agent.id).length;
  return (
    <div onClick={onClick}
      style={{ background: 'var(--bg-3)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-lg)', padding: '14px 16px', cursor: 'pointer', transition: 'all 100ms' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-3)'; e.currentTarget.style.background = 'var(--bg-4)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.background = 'var(--bg-3)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AgentAvatar name={agent.name} size={32} color={agent.color} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{agent.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{agent.role}</div>
          </div>
        </div>
        <Badge variant="default" size="xs">{agent.model.split('-')[1]}</Badge>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-3)' }}>
        <span>{agent.totalRuns} runs</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>${agent.totalCost.toFixed(2)} spent</span>
        <span>${agent.maxBudget} max</span>
        <span style={{ marginLeft: 'auto' }}>{runCount} tasks</span>
      </div>
    </div>
  );
}

function SkillPicker({ allSkills, selectedIds, onChange }) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const allTags = [...new Set(allSkills.flatMap(s => s.tags))];
  const filtered = allSkills.filter(s => {
    const q = query.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q);
    const matchT = !activeTag || s.tags.includes(activeTag);
    return matchQ && matchT;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills…" prefix={<Icon name="search" size={12} />} size="sm" style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {allTags.map(t => (
            <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</Chip>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
        {filtered.map(skill => {
          const sel = selectedIds.includes(skill.id);
          return (
            <div key={skill.id}
              onClick={() => onChange(sel ? selectedIds.filter(id => id !== skill.id) : [...selectedIds, skill.id])}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', border: `1px solid ${sel ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border-1)'}`, background: sel ? 'var(--accent-dim)' : 'var(--bg-3)', transition: 'all 80ms' }}
              onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--bg-4)'; }}
              onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'var(--bg-3)'; }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 'var(--r-sm)', border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border-3)'}`, background: sel ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, transition: 'all 80ms' }}>
                {sel && <Icon name="check" size={10} style={{ color: 'white' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: sel ? 'var(--accent)' : 'var(--text-1)' }}>{skill.name}</span>
                  <Badge variant={skill.scope === 'public' ? 'default' : skill.scope === 'user' ? 'accent' : 'orange'} size="xs">{skill.scope}</Badge>
                  {skill.tags.map(t => <Chip key={t}>{t}</Chip>)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{skill.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {selectedIds.length} skill{selectedIds.length !== 1 ? 's' : ''} selected
      </div>
    </div>
  );
}

function AgentEditor({ agent, allSkills, allTasks, onSave, onBack }) {
  const [form, setForm] = useState({ ...agent });
  const [tab, setTab] = useState('config'); // config | prompt | skills

  const tabs = [{ id: 'config', label: 'Config' }, { id: 'prompt', label: 'System Prompt' }, { id: 'skills', label: `Skills (${form.skillIds.length})` }];

  const field = (key, label, opts = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '.03em' }}>{label}</label>
      {opts.select ? (
        <select value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-sans)', padding: '0 10px', height: 28, outline: 'none', cursor: 'pointer' }}>
          {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}
        </select>
      ) : opts.number ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="number" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) }))} min={0} max={100} step={0.5}
            style={{ width: 80, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '4px 10px', height: 28, outline: 'none' }} />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>USD maximum per run</span>
        </div>
      ) : (
        <Input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} size="sm" mono={opts.mono} />
      )}
    </div>
  );

  const totalTasks = allTasks.filter(t => t.agentId === agent.id).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-sans)', padding: 0 }}>
          <Icon name="arrowLeft" size={14} />Back
        </button>
        <Divider vertical />
        <AgentAvatar name={agent.name} size={26} color={agent.color} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{agent.name}</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>{agent.totalRuns} runs · ${agent.totalCost.toFixed(2)} · {totalTasks} tasks</span>
          <Button variant="primary" size="sm" icon="save" onClick={() => onSave(form)}>Save</Button>
          <Button variant="danger" size="xs" icon="trash">Delete</Button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-1)', padding: '0 20px', flexShrink: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--text-1)' : 'var(--text-3)', borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`, transition: 'all 80ms', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {tab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
            {field('name', 'Name')}
            {field('role', 'Role / description')}
            {field('model', 'Model', { select: true })}
            {field('maxBudget', 'Max budget (USD)', { number: true })}
          </div>
        )}
        {tab === 'prompt' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>System Prompt</div>
            <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '12px', resize: 'vertical', minHeight: 320, outline: 'none', lineHeight: 1.7, width: '100%', transition: 'border-color 80ms' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-2)'}
            />
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{form.systemPrompt.split(/\s+/).length} words · {form.systemPrompt.length} chars</div>
          </div>
        )}
        {tab === 'skills' && (
          <SkillPicker allSkills={allSkills} selectedIds={form.skillIds} onChange={ids => setForm(f => ({ ...f, skillIds: ids }))} />
        )}
      </div>
    </div>
  );
}

function AgentsView({ agents: initialAgents, skills, addToast }) {
  const { MOCK_TASKS } = window.MOCK_DATA;
  const allTasks = Object.values(MOCK_TASKS).flat();
  const [agents, setAgents] = useState(initialAgents);
  const [editing, setEditing] = useState(null);

  if (editing) return (
    <AgentEditor agent={editing} allSkills={skills} allTasks={allTasks}
      onSave={updated => { setAgents(as => as.map(a => a.id === updated.id ? updated : a)); addToast('Agent saved', 'success'); setEditing(null); }}
      onBack={() => setEditing(null)}
    />
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>Agents</h1>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{agents.length} configured</p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => addToast('New agent form coming soon', 'default')}>New agent</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
        {agents.map(a => <AgentCard key={a.id} agent={a} tasks={allTasks} onClick={() => setEditing(a)} />)}
      </div>
    </div>
  );
}

Object.assign(window, { AgentsView, AgentEditor, SkillPicker });
