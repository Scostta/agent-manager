// Skills catalog + CLAUDE.md editor
const { useState } = React;

// ─── Skills View ──────────────────────────────────────────────────────────────
function SkillsView({ skills: initialSkills, addToast }) {
  const [skills, setSkills] = useState(initialSkills);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [selected, setSelected] = useState(null);

  const allTags = [...new Set(skills.flatMap(s => s.tags))];
  const filtered = skills.filter(s => {
    const q = query.toLowerCase();
    return (!q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.tags.some(t => t.includes(q)))
      && (!activeTag || s.tags.includes(activeTag));
  });

  const scopeVariant = { public: 'default', user: 'accent', project: 'orange' };

  const SKILL_DETAIL = `# ${selected?.name || ''}

## Description
${selected?.desc || ''}

## Usage
Attach this skill to an agent to enable this capability. The agent will have access to the skill's instructions and tools defined in this file.

## Tags
${selected?.tags?.join(', ') || ''}

## Path
\`${selected?.path || ''}\`

## Last modified
2025-04-22 18:34 UTC`;

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: selected ? '1px solid var(--border-1)' : 'none' }}>
        {/* Toolbar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills…" prefix={<Icon name="search" size={12} />} size="sm" style={{ flex: 1 }} />
          <Button variant="default" size="sm" icon="refresh" onClick={() => addToast('Filesystem rescanned — 0 new skills found', 'success')}>Rescan</Button>
        </div>
        {/* Tag filters */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
          <Chip active={!activeTag} onClick={() => setActiveTag(null)}>All</Chip>
          {allTags.map(t => <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</Chip>)}
        </div>
        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, alignContent: 'start' }}>
          {filtered.map(skill => (
            <div key={skill.id} onClick={() => setSelected(skill)}
              style={{ background: selected?.id === skill.id ? 'var(--bg-4)' : 'var(--bg-3)', border: `1px solid ${selected?.id === skill.id ? 'var(--border-3)' : 'var(--border-1)'}`, borderRadius: 'var(--r-lg)', padding: '12px 14px', cursor: 'pointer', transition: 'all 80ms' }}
              onMouseEnter={e => { if (selected?.id !== skill.id) { e.currentTarget.style.background = 'var(--bg-4)'; e.currentTarget.style.borderColor = 'var(--border-2)'; }}}
              onMouseLeave={e => { if (selected?.id !== skill.id) { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.borderColor = 'var(--border-1)'; }}}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{skill.name}</span>
                <Badge variant={scopeVariant[skill.scope] || 'default'} size="xs">{skill.scope}</Badge>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{skill.desc}</p>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {skill.tags.map(t => <Chip key={t}>{t}</Chip>)}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              No skills match your search
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="slide-right" style={{ width: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{selected.name}</span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}><Icon name="x" size={13} /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <Badge variant={scopeVariant[selected.scope]} size="sm">{selected.scope}</Badge>
              {selected.tags.map(t => <Chip key={t}>{t}</Chip>)}
            </div>
            <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--bg-3)', borderRadius: 'var(--r-md)', padding: '12px', border: '1px solid var(--border-1)' }}>
              {SKILL_DETAIL}
            </pre>
            <div style={{ marginTop: 12, display: 'flex', gap: 5, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
              <Icon name="link" size={10} />
              {selected.path}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CLAUDE.md Editor ─────────────────────────────────────────────────────────
function ClaudeMdView({ docs: initialDocs, addToast }) {
  const [docs, setDocs] = useState(initialDocs);
  const [activeId, setActiveId] = useState(initialDocs[0]?.id);
  const [preview, setPreview] = useState(false);

  const active = docs.find(d => d.id === activeId);
  const [content, setContent] = useState(active?.content || '');

  const scopeGroups = [
    { label: 'Global', ids: docs.filter(d => d.scope === 'global').map(d => d.id) },
    { label: 'Project', ids: docs.filter(d => d.scope === 'project').map(d => d.id) },
    { label: 'Agent', ids: docs.filter(d => d.scope === 'agent').map(d => d.id) },
  ].filter(g => g.ids.length > 0);

  const selectDoc = (id) => {
    setActiveId(id);
    const d = docs.find(x => x.id === id);
    setContent(d?.content || '');
  };

  const save = () => {
    setDocs(ds => ds.map(d => d.id === activeId ? { ...d, content } : d));
    addToast('CLAUDE.md saved', 'success');
  };

  // Very simple markdown renderer
  const renderMarkdown = (md) => {
    const lines = md.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('# ')) return <div key={i} style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 6, marginTop: i > 0 ? 16 : 0 }}>{line.slice(2)}</div>;
      if (line.startsWith('## ')) return <div key={i} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4, marginTop: 14 }}>{line.slice(3)}</div>;
      if (line.startsWith('### ')) return <div key={i} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 3, marginTop: 10 }}>{line.slice(4)}</div>;
      if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}><span style={{ color: 'var(--accent)', marginTop: 2 }}>·</span>{line.slice(2)}</div>;
      if (line.startsWith('`') && line.endsWith('`')) return <code key={i} style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-4)', padding: '2px 6px', borderRadius: 3, color: 'var(--accent)', marginBottom: 2 }}>{line.slice(1, -1)}</code>;
      if (!line) return <div key={i} style={{ height: 6 }} />;
      return <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{line}</div>;
    });
  };

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 200, borderRight: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0, background: 'var(--bg-2)' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Files</span>
          <button onClick={() => addToast('New CLAUDE.md created', 'success')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}><Icon name="plus" size={13} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {scopeGroups.map(group => (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.06em', textTransform: 'uppercase', padding: '0 6px', marginBottom: 4 }}>{group.label}</div>
              {group.ids.map(id => {
                const doc = docs.find(d => d.id === id);
                if (!doc) return null;
                const isActive = id === activeId;
                return (
                  <button key={id} onClick={() => selectDoc(id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer', width: '100%', background: isActive ? 'var(--bg-active)' : 'transparent', color: isActive ? 'var(--text-1)' : 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-sans)', textAlign: 'left', transition: 'all 80ms' }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Icon name="file" size={12} style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)' }} />
                    <span className="truncate">{doc.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {active && <>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--bg-2)' }}>
            <Icon name="file" size={13} style={{ color: 'var(--text-3)' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{active.name}</span>
            {active.path && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{active.path}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={() => setPreview(p => !p)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-2)', background: preview ? 'var(--bg-5)' : 'var(--bg-4)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                <Icon name="eye" size={11} />{preview ? 'Edit' : 'Preview'}
              </button>
              <Button variant="primary" size="sm" icon="save" onClick={save}>Save</Button>
              {active.path && <Button variant="default" size="sm" icon="refresh" onClick={() => addToast('Synced to disk', 'success')}>Sync</Button>}
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {!preview ? (
              <textarea value={content} onChange={e => setContent(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-base)', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 13, fontFamily: 'var(--font-mono)', padding: '16px 20px', resize: 'none', lineHeight: 1.8, tabSize: 2 }} />
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', maxWidth: 720 }}>
                {renderMarkdown(content)}
              </div>
            )}
          </div>
        </>}
      </div>
    </div>
  );
}

Object.assign(window, { SkillsView, ClaudeMdView });
