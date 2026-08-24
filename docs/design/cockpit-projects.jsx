// Projects list view
const { useState } = React;

function ProjectsView({ projects, tasks, onSelect, addToast }) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');

  const getTaskCounts = (pid) => {
    const ts = tasks[pid] || [];
    return {
      todo: ts.filter(t => t.status === 'todo').length,
      inProgress: ts.filter(t => t.status === 'in-progress').length,
      review: ts.filter(t => t.status === 'review').length,
      done: ts.filter(t => t.status === 'done').length,
      blocked: ts.filter(t => t.status === 'blocked').length,
    };
  };

  const formatRelative = (ts) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
  };

  const activeRunsPerProject = (pid) => (tasks[pid] || []).filter(t => t.activeRun).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>Projects</h1>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{projects.length} repositories</p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => setShowNew(!showNew)}>New project</Button>
      </div>

      {showNew && (
        <div className="fade-in" style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 2 }}>New project</div>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="project-name" size="sm" />
          <Input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="~/dev/project-name" mono size="sm" />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="xs" onClick={() => { addToast('Project created', 'success'); setShowNew(false); }}>Create</Button>
            <Button variant="ghost" size="xs" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {projects.map(p => {
          const counts = getTaskCounts(p.id);
          const runs = activeRunsPerProject(p.id);
          return (
            <div key={p.id}
              onClick={() => onSelect(p.id)}
              style={{ background: 'var(--bg-3)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-lg)', padding: '16px', cursor: 'pointer', transition: 'all 100ms', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-3)'; e.currentTarget.style.background = 'var(--bg-4)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-1)'; e.currentTarget.style.background = 'var(--bg-3)'; }}
            >
              {runs > 0 && (
                <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <StatusDot status="running" pulse />
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>{runs} running</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--r-md)', background: 'var(--bg-5)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="folder" size={15} style={{ color: 'var(--text-2)' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.desc}</div>
                </div>
              </div>

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="gitBranch" size={11} style={{ color: 'var(--text-3)' }} />
                {p.path}
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {counts.todo > 0 && <Badge variant="default" size="xs">{counts.todo} todo</Badge>}
                {counts.inProgress > 0 && <Badge variant="blue" size="xs" dot>{counts.inProgress} in progress</Badge>}
                {counts.review > 0 && <Badge variant="yellow" size="xs" dot>{counts.review} review</Badge>}
                {counts.done > 0 && <Badge variant="green" size="xs">{counts.done} done</Badge>}
                {counts.blocked > 0 && <Badge variant="red" size="xs" dot>{counts.blocked} blocked</Badge>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)' }}>
                  <Icon name="gitBranch" size={10} />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{p.branch}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="clock" size={10} />
                  {formatRelative(p.lastActive)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { ProjectsView });
