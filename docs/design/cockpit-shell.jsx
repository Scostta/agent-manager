// Shell layout: Sidebar, Header, Command Palette, App routing
const { useState, useEffect, useRef, useCallback } = React;

function Sidebar({ currentView, setView, currentProjectId, setProjectId, projects, activeRunCount }) {
  const navItems = [
    { id: 'projects', icon: 'folder', label: 'Projects' },
    { id: 'agents', icon: 'bot', label: 'Agents' },
    { id: 'skills', icon: 'layers', label: 'Skills' },
    { id: 'claudemd', icon: 'file', label: 'CLAUDE.md' },
  ];

  return (
    <div style={{
      width: 'var(--sidebar-w)', height: '100vh', flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-2)', borderRight: '1px solid var(--border-1)',
    }}>
      {/* Logo */}
      <div style={{ height: 'var(--header-h)', display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: '1px solid var(--border-1)', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-dim)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="activity" size={12} style={{ color: 'var(--accent)' }} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', letterSpacing: '-.01em' }}>Cockpit</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = currentView === item.id || (item.id === 'projects' && currentView === 'kanban');
          return (
            <button key={item.id} onClick={() => setView(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px',
                borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer', width: '100%',
                background: active ? 'var(--bg-active)' : 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: active ? 500 : 400,
                transition: 'all 80ms', textAlign: 'left',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          );
        })}

        {/* Recent projects */}
        {projects.length > 0 && (
          <>
            <div style={{ margin: '12px 4px 4px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Recent
            </div>
            {projects.slice(0,3).map(p => {
              const active = currentView === 'kanban' && currentProjectId === p.id;
              return (
                <button key={p.id}
                  onClick={() => { setProjectId(p.id); setView('kanban'); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                    borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer', width: '100%',
                    background: active ? 'var(--bg-active)' : 'transparent',
                    color: active ? 'var(--text-1)' : 'var(--text-3)',
                    fontSize: 12, fontFamily: 'var(--font-sans)', textAlign: 'left',
                    transition: 'all 80ms',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = active ? 'var(--text-1)' : 'var(--text-3)'; }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: active ? 'var(--accent)' : 'var(--border-3)', flexShrink: 0 }} />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Bottom: active runs badge + settings */}
      <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {activeRunCount > 0 && (
          <button onClick={() => setView('runs')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-sans)', width: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot status="running" pulse />
              <span style={{ fontWeight: 500 }}>{activeRunCount} running</span>
            </div>
            <Icon name="chevronRight" size={11} />
          </button>
        )}
        <button onClick={() => setView('settings')}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px', borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-sans)', transition: 'all 80ms' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}
        >
          <Icon name="settings" size={14} />
          Settings
        </button>
      </div>
    </div>
  );
}

function Header({ currentView, currentProject, activeRunCount, onOpenRunTray, onCmdK }) {
  const breadcrumb = {
    projects: [{ label: 'Projects' }],
    kanban: [{ label: 'Projects', action: true }, { label: currentProject?.name || '' }],
    agents: [{ label: 'Agents' }],
    skills: [{ label: 'Skills' }],
    claudemd: [{ label: 'CLAUDE.md' }],
    settings: [{ label: 'Settings' }],
  };
  const crumbs = breadcrumb[currentView] || [{ label: currentView }];

  return (
    <div style={{
      height: 'var(--header-h)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', borderBottom: '1px solid var(--border-1)',
      background: 'var(--bg-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Icon name="chevronRight" size={11} style={{ color: 'var(--text-3)' }} />}
            <span style={{ fontSize: 13, fontWeight: i === crumbs.length - 1 ? 500 : 400, color: i === crumbs.length - 1 ? 'var(--text-1)' : 'var(--text-3)', cursor: c.action ? 'pointer' : 'default' }}>
              {c.label}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {activeRunCount > 0 && (
          <button onClick={onOpenRunTray}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'var(--accent-dim)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 500, cursor: 'pointer' }}>
            <StatusDot status="running" pulse />
            {activeRunCount} {activeRunCount === 1 ? 'run' : 'runs'} active
          </button>
        )}
        <button onClick={onCmdK}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-4)', border: '1px solid var(--border-2)', color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'all 80ms' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-3)'; e.currentTarget.style.color = 'var(--text-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-2)'; e.currentTarget.style.color = 'var(--text-3)'; }}
        >
          <Icon name="search" size={11} />
          <span>Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
    </div>
  );
}

function CommandPalette({ open, onClose, projects, agents, tasks, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const [selected, setSelected] = useState(0);

  const allItems = [
    ...projects.map(p => ({ type: 'project', label: p.name, sub: p.path, icon: 'folder', action: () => onNavigate('kanban', p.id) })),
    ...agents.map(a => ({ type: 'agent', label: a.name, sub: a.role, icon: 'bot', action: () => onNavigate('agents') })),
    { type: 'action', label: 'New project', sub: 'Create a new project', icon: 'plus', action: () => onNavigate('projects') },
    { type: 'action', label: 'New agent', sub: 'Configure a new agent', icon: 'plus', action: () => onNavigate('agents') },
    { type: 'action', label: 'Go to Skills', sub: 'Browse available skills', icon: 'layers', action: () => onNavigate('skills') },
    { type: 'action', label: 'Go to CLAUDE.md', sub: 'Edit instruction files', icon: 'file', action: () => onNavigate('claudemd') },
    ...Object.values(tasks).flat().filter(t => t.status === 'todo' || t.status === 'in-progress').slice(0,5).map(t => ({
      type: 'task', label: `Run: ${t.title}`, sub: `Task · ${t.status}`, icon: 'play',
      action: () => {}
    })),
  ];

  const filtered = query ? allItems.filter(i => i.label.toLowerCase().includes(query.toLowerCase()) || i.sub.toLowerCase().includes(query.toLowerCase())) : allItems;

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(''); setSelected(0); } }, [open]);
  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s+1, filtered.length-1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s-1, 0)); }
      if (e.key === 'Enter') { filtered[selected]?.action(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, selected]);

  if (!open) return null;

  const typeColors = { project: 'var(--accent)', agent: 'var(--green)', action: 'var(--text-3)', task: 'var(--orange)' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="slide-up" onClick={e => e.stopPropagation()} style={{ width: 560, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}>
          <Icon name="search" size={15} style={{ color: 'var(--text-3)' }} />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects, agents, tasks…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 14, fontFamily: 'var(--font-sans)' }} />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px' }}>
          {filtered.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No results for "{query}"</div>}
          {filtered.map((item, i) => (
            <div key={i}
              onClick={() => { item.action(); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', background: i === selected ? 'var(--bg-5)' : 'transparent', marginBottom: 1 }}
              onMouseEnter={() => setSelected(i)}
            >
              <span style={{ width: 28, height: 28, borderRadius: 'var(--r-md)', background: 'var(--bg-5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: typeColors[item.type] }}>
                <Icon name={item.icon} size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: item.type === 'project' ? 'var(--font-mono)' : 'var(--font-sans)' }}>{item.sub}</div>
              </div>
              <Badge variant="ghost" size="xs">{item.type}</Badge>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 14, alignItems: 'center' }}>
          {[['↑↓', 'navigate'], ['↵', 'select'], ['esc', 'close']].map(([k, l]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Kbd>{k}</Kbd>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppShell({ initialView = 'projects' }) {
  const { MOCK_PROJECTS, MOCK_AGENTS, MOCK_TASKS, MOCK_SKILLS, MOCK_CLAUDE_MDS } = window.MOCK_DATA;
  const [view, setView] = useState(initialView);
  const [projectId, setProjectId] = useState('p1');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const projects = MOCK_PROJECTS;
  const agents = MOCK_AGENTS;
  const tasks = MOCK_TASKS;

  const activeRunCount = Object.values(tasks).flat().filter(t => t.activeRun).length;
  const currentProject = projects.find(p => p.id === projectId);

  const addToast = useCallback((msg, type = 'default') => {
    const id = Date.now();
    setToasts(ts => [...ts, { id, msg, type }]);
  }, []);

  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navigateTo = (v, pid) => {
    setView(v);
    if (pid) setProjectId(pid);
    setCmdOpen(false);
  };

  const renderView = () => {
    switch (view) {
      case 'projects': return <ProjectsView projects={projects} tasks={tasks} onSelect={(id) => { setProjectId(id); setView('kanban'); }} addToast={addToast} />;
      case 'kanban': return <KanbanView project={currentProject} tasks={tasks[projectId] || []} agents={agents} skills={MOCK_SKILLS} addToast={addToast} />;
      case 'agents': return <AgentsView agents={agents} skills={MOCK_SKILLS} addToast={addToast} />;
      case 'skills': return <SkillsView skills={MOCK_SKILLS} addToast={addToast} />;
      case 'claudemd': return <ClaudeMdView docs={MOCK_CLAUDE_MDS} addToast={addToast} />;
      case 'settings': return <SettingsView />;
      default: return null;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar currentView={view} setView={setView} currentProjectId={projectId} setProjectId={setProjectId} projects={projects} activeRunCount={activeRunCount} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <Header currentView={view} currentProject={currentProject} activeRunCount={activeRunCount} onOpenRunTray={() => {}} onCmdK={() => setCmdOpen(true)} />
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {renderView()}
        </div>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} projects={projects} agents={agents} tasks={tasks} onNavigate={navigateTo} />
      <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000 }}>
        {toasts.map(t => <Toast key={t.id} message={t.msg} type={t.type} onDismiss={() => setToasts(ts => ts.filter(x => x.id !== t.id))} />)}
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div style={{ padding: 32, color: 'var(--text-2)', fontSize: 13 }}>
      <p>Settings panel — coming soon.</p>
    </div>
  );
}

Object.assign(window, { AppShell, Sidebar, Header, CommandPalette });
