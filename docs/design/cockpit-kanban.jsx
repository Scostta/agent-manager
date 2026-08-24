// Kanban board + Task Drawer + Run Console panel
const { useState, useEffect, useRef, useCallback } = React;

const COLUMNS = [
  { id: 'todo',        label: 'Todo',        color: 'var(--text-3)' },
  { id: 'in-progress', label: 'In Progress', color: 'var(--blue)' },
  { id: 'review',      label: 'Review',      color: 'var(--yellow)' },
  { id: 'done',        label: 'Done',        color: 'var(--green)' },
  { id: 'blocked',     label: 'Blocked',     color: 'var(--red)' },
];

function formatRelative(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}
function formatDuration(ms) {
  const s = Math.floor(ms/1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}
function fmtTokens(n) {
  if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`;
  return `${n}`;
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({ task, agents, skills, onSelect, onDragStart, onDragEnd, isDragging, compact }) {
  const agent = agents.find(a => a.id === task.agentId);
  const taskSkills = skills.filter(s => task.skillIds.includes(s.id));
  const [elapsed, setElapsed] = useState(task.activeRun ? Math.floor((Date.now() - task.activeRun.startedAt) / 1000) : 0);

  useEffect(() => {
    if (!task.activeRun) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - task.activeRun.startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [task.activeRun]);

  const priorityColors = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-3)' };

  return (
    <div
      draggable
      onDragStart={e => { onDragStart(task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(task)}
      style={{
        background: isDragging ? 'var(--bg-5)' : 'var(--bg-3)',
        border: `1px solid ${task.activeRun ? 'color-mix(in srgb, var(--blue) 30%, var(--border-2))' : 'var(--border-1)'}`,
        borderRadius: 'var(--r-lg)',
        padding: compact ? '8px 10px' : '10px 12px',
        cursor: 'grab',
        opacity: isDragging ? .4 : 1,
        transition: 'border-color 80ms, background 80ms',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isDragging) { e.currentTarget.style.borderColor = 'var(--border-3)'; e.currentTarget.style.background = 'var(--bg-4)'; }}}
      onMouseLeave={e => { e.currentTarget.style.borderColor = task.activeRun ? 'color-mix(in srgb, var(--blue) 30%, var(--border-2))' : 'var(--border-1)'; e.currentTarget.style.background = isDragging ? 'var(--bg-5)' : 'var(--bg-3)'; }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: compact ? 5 : 7 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: priorityColors[task.priority] || 'var(--text-3)', flexShrink: 0, marginTop: 5 }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', lineHeight: 1.4, flex: 1 }}>{task.title}</span>
      </div>

      {/* Active run indicator */}
      {task.activeRun && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, padding: '4px 7px', background: 'var(--blue-dim)', borderRadius: 'var(--r-sm)', border: '1px solid color-mix(in srgb, var(--blue) 20%, transparent)' }}>
          <StatusDot status="running" pulse />
          <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 500 }}>{formatDuration(elapsed * 1000)}</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {fmtTokens(task.activeRun.tokens.input + task.activeRun.tokens.output)} tok
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--blue)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            ${task.activeRun.cost.toFixed(2)}
          </span>
        </div>
      )}

      {/* Bottom row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {agent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <AgentAvatar name={agent.name} size={16} color={agent.color} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{agent.name}</span>
          </div>
        )}
        {!compact && taskSkills.slice(0,2).map(s => (
          <Chip key={s.id}>{s.name}</Chip>
        ))}
        {taskSkills.length > 2 && !compact && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>+{taskSkills.length - 2}</span>}
        {task.lastRun && !task.activeRun && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: task.lastRun.status === 'ok' ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Icon name={task.lastRun.status === 'ok' ? 'check' : 'x'} size={9} />
            {formatRelative(task.lastRun.finishedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Task Drawer ──────────────────────────────────────────────────────────────
function TaskDrawer({ task, agents, skills, onClose, onRun, onUpdateStatus }) {
  if (!task) return null;
  const agent = agents.find(a => a.id === task.agentId);
  const taskSkills = skills.filter(s => task.skillIds?.includes(s.id));
  const [showRun, setShowRun] = useState(!!task.activeRun);

  const statusVariants = { todo: 'default', 'in-progress': 'blue', review: 'yellow', done: 'green', blocked: 'red' };
  const statusLabels = { todo: 'Todo', 'in-progress': 'In Progress', review: 'Review', done: 'Done', blocked: 'Blocked' };

  return (
    <div className="slide-right" style={{ width: 360, borderLeft: '1px solid var(--border-1)', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Badge variant={statusVariants[task.status]} size="sm" dot>{statusLabels[task.status]}</Badge>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="ghost" size="xs" icon="pencil">Edit</Button>
          <Button variant="ghost" size="xs" icon="x" onClick={onClose} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4, marginBottom: 10 }}>{task.title}</h2>
        {task.desc && <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 16 }}>{task.desc}</p>}
        {task.blockReason && (
          <div style={{ display: 'flex', gap: 8, padding: '8px 10px', background: 'var(--red-dim)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)', borderRadius: 'var(--r-md)', marginBottom: 14 }}>
            <Icon name="alertCircle" size={13} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--red)' }}>{task.blockReason}</span>
          </div>
        )}

        <Divider label="Assignment" />
        <div style={{ margin: '12px 0' }}>
          {agent ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AgentAvatar name={agent.name} size={28} color={agent.color} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{agent.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{agent.model} · ${agent.maxBudget} budget</div>
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No agent assigned</span>
          )}
        </div>

        {taskSkills.length > 0 && <>
          <Divider label="Skills" />
          <div style={{ margin: '10px 0 14px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {taskSkills.map(s => <Chip key={s.id} active>{s.name}</Chip>)}
          </div>
        </>}

        <Divider label="Run history" />
        <div style={{ marginTop: 10 }}>
          {task.activeRun && (
            <div style={{ padding: '8px 10px', background: 'var(--blue-dim)', border: '1px solid color-mix(in srgb, var(--blue) 20%, transparent)', borderRadius: 'var(--r-md)', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status="running" pulse />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--blue)' }}>Running</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>started {formatRelative(task.activeRun.startedAt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {[['In', fmtTokens(task.activeRun.tokens.input)], ['Out', fmtTokens(task.activeRun.tokens.output)], ['Cache', fmtTokens(task.activeRun.tokens.cache)], ['Cost', `$${task.activeRun.cost.toFixed(3)}`]].map(([l,v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{l}</div>
                    <MetricValue value={v} style={{ fontSize: 12 }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {task.lastRun && (
            <div style={{ padding: '8px 10px', background: 'var(--bg-3)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={task.lastRun.status === 'ok' ? 'check' : 'x'} size={12} style={{ color: task.lastRun.status === 'ok' ? 'var(--green)' : 'var(--red)' }} />
                  <span style={{ fontSize: 12, color: task.lastRun.status === 'ok' ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>{task.lastRun.status === 'ok' ? 'Completed' : 'Failed'}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{formatRelative(task.lastRun.finishedAt)}</span>
              </div>
            </div>
          )}
          {!task.activeRun && !task.lastRun && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>No runs yet</div>
          )}
        </div>

        {/* Move to column */}
        <div style={{ marginTop: 16 }}>
          <Divider label="Move to" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
            {COLUMNS.filter(c => c.id !== task.status).map(c => (
              <Button key={c.id} variant="ghost" size="xs" onClick={() => { onUpdateStatus(task.id, c.id); onClose(); }}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {task.activeRun ? (
          <Button variant="danger" size="sm" icon="stop" style={{ flex: 1 }}>Cancel run</Button>
        ) : (
          <Button variant="primary" size="sm" icon="play" style={{ flex: 1 }} onClick={() => { onRun(task); setShowRun(true); }}>
            Run now
          </Button>
        )}
        <Button variant="default" size="sm" icon="expand" onClick={() => {}} />
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────
function KanbanColumn({ col, tasks, agents, skills, onSelectTask, dragOverCol, onDragOver, onDragLeave, onDrop, draggedId, compact, onAddTask }) {
  const isOver = dragOverCol === col.id;
  return (
    <div
      style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={e => { e.preventDefault(); onDragOver(col.id); }}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(col.id)}
    >
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, padding: '0 2px', flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '.02em' }}>{col.label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 2 }}>{tasks.length}</span>
      </div>

      {/* Cards */}
      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
        padding: '4px 4px',
        background: isOver ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'transparent',
        borderRadius: 'var(--r-lg)',
        border: isOver ? '1.5px dashed color-mix(in srgb, var(--accent) 40%, transparent)' : '1.5px solid transparent',
        transition: 'all 100ms',
      }}>
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} agents={agents} skills={skills} onSelect={onSelectTask}
            onDragStart={(id) => {}} onDragEnd={() => {}}
            isDragging={draggedId === t.id} compact={compact} />
        ))}
        {tasks.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>
            {col.id === 'todo' ? 'No tasks yet' : '—'}
          </div>
        )}
        <button onClick={() => onAddTask(col.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-2)', background: 'transparent', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 80ms', marginTop: 2 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-3)'; e.currentTarget.style.color = 'var(--text-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-2)'; e.currentTarget.style.color = 'var(--text-3)'; }}
        >
          <Icon name="plus" size={11} /> Add task
        </button>
      </div>
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({ project, tasks: initialTasks, agents, skills, addToast }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [selectedTask, setSelectedTask] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [compact, setCompact] = useState(false);
  const [showRunConsole, setShowRunConsole] = useState(false);
  const [runningTask, setRunningTask] = useState(null);
  const [newTaskCol, setNewTaskCol] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Simulate live token updates for active runs
  useEffect(() => {
    const iv = setInterval(() => {
      setTasks(ts => ts.map(t => {
        if (!t.activeRun) return t;
        const delta = Math.floor(Math.random() * 120) + 20;
        const costDelta = delta * 0.000003;
        return { ...t, activeRun: { ...t.activeRun, tokens: { ...t.activeRun.tokens, output: t.activeRun.tokens.output + delta }, cost: t.activeRun.cost + costDelta } };
      }));
    }, 1800);
    return () => clearInterval(iv);
  }, []);

  const handleDrop = useCallback((targetColId) => {
    if (!draggedId || !targetColId) return;
    setTasks(ts => ts.map(t => t.id === draggedId ? { ...t, status: targetColId } : t));
    setDraggedId(null);
    setDragOverCol(null);
    addToast(`Task moved to ${COLUMNS.find(c => c.id === targetColId)?.label}`, 'success');
  }, [draggedId, addToast]);

  const handleRun = (task) => {
    setRunningTask(task);
    setShowRunConsole(true);
    addToast(`Starting run for "${task.title}"`, 'default');
  };

  const handleAddTask = (colId) => {
    setNewTaskCol(colId);
    setNewTaskTitle('');
  };

  const submitNewTask = () => {
    if (!newTaskTitle.trim()) return;
    const id = 't' + Date.now();
    setTasks(ts => [...ts, { id, title: newTaskTitle, desc: '', status: newTaskCol, agentId: null, skillIds: [], activeRun: null, lastRun: null, priority: 'medium' }]);
    setNewTaskCol(null);
    setNewTaskTitle('');
    addToast('Task created', 'success');
  };

  const activeRuns = tasks.filter(t => t.activeRun).length;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--bg-2)' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            {project && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="gitBranch" size={10} />
                {project.path}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {activeRuns > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: 'var(--blue-dim)', borderRadius: 'var(--r-sm)', border: '1px solid color-mix(in srgb, var(--blue) 20%, transparent)' }}>
                <StatusDot status="running" pulse />
                <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 500 }}>{activeRuns} active</span>
              </div>
            )}
            <button onClick={() => setCompact(c => !c)}
              style={{ padding: '4px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border-2)', background: compact ? 'var(--bg-5)' : 'var(--bg-4)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="layers" size={11} />
              {compact ? 'Expand' : 'Compact'}
            </button>
            <Kbd>J/K</Kbd><span style={{ fontSize: 10, color: 'var(--text-3)' }}>navigate</span>
            <Kbd>R</Kbd><span style={{ fontSize: 10, color: 'var(--text-3)' }}>run</span>
          </div>
        </div>

        {/* Board */}
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 16px', display: 'flex', gap: 12 }}>
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.id);
            return (
              <React.Fragment key={col.id}>
                <KanbanColumn
                  col={col} tasks={colTasks} agents={agents} skills={skills}
                  onSelectTask={(t) => { setSelectedTask(t); setShowRunConsole(false); }}
                  dragOverCol={dragOverCol}
                  onDragOver={(id) => setDragOverCol(id)}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={handleDrop}
                  draggedId={draggedId}
                  compact={compact}
                  onAddTask={handleAddTask}
                />
                {newTaskCol === col.id && (
                  <div style={{ position: 'absolute' }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* New task inline form */}
      {newTaskCol && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)' }} onClick={() => setNewTaskCol(null)}>
          <div className="slide-up" onClick={e => e.stopPropagation()} style={{ width: 440, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-xl)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>New task in {COLUMNS.find(c=>c.id===newTaskCol)?.label}</div>
            <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewTask(); if (e.key === 'Escape') setNewTaskCol(null); }}
              placeholder="Task title…"
              style={{ background: 'var(--bg-4)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-md)', padding: '8px 12px', color: 'var(--text-1)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" onClick={submitNewTask}>Create task</Button>
              <Button variant="ghost" size="sm" onClick={() => setNewTaskCol(null)}>Cancel</Button>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}><Kbd>↵</Kbd>&nbsp;to create</span>
            </div>
          </div>
        </div>
      )}

      {/* Task Drawer */}
      {selectedTask && !showRunConsole && (
        <TaskDrawer task={selectedTask} agents={agents} skills={skills}
          onClose={() => setSelectedTask(null)}
          onRun={handleRun}
          onUpdateStatus={(id, status) => setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t))}
        />
      )}

      {/* Run Console panel */}
      {showRunConsole && runningTask && (
        <RunConsole task={runningTask} agents={agents} onClose={() => { setShowRunConsole(false); setRunningTask(null); }} />
      )}
    </div>
  );
}

Object.assign(window, { KanbanView, TaskCard, TaskDrawer });
