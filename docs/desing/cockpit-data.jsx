// Mock data for Claude Cockpit prototype
const MOCK_SKILLS = [
  { id: 's1', name: 'CreatePDF', desc: 'Generate and manipulate PDF documents', tags: ['docs', 'output'], scope: 'public', path: '~/.claude/skills/CreatePDF.md' },
  { id: 's2', name: 'DesignUI', desc: 'Create HTML/CSS UI components and layouts', tags: ['frontend', 'design'], scope: 'public', path: '~/.claude/skills/DesignUI.md' },
  { id: 's3', name: 'ManageWord', desc: 'Read and write Microsoft Word documents', tags: ['docs', 'office'], scope: 'public', path: '~/.claude/skills/ManageWord.md' },
  { id: 's4', name: 'WriteTests', desc: 'Generate unit and integration tests', tags: ['testing', 'quality'], scope: 'public', path: '~/.claude/skills/WriteTests.md' },
  { id: 's5', name: 'RefactorCode', desc: 'Automated code refactoring and cleanup', tags: ['code', 'quality'], scope: 'user', path: '~/.claude/skills/RefactorCode.md' },
  { id: 's6', name: 'DocStrings', desc: 'Add and improve code documentation', tags: ['docs', 'code'], scope: 'user', path: '~/.claude/skills/DocStrings.md' },
  { id: 's7', name: 'OpenAPI', desc: 'Generate and validate OpenAPI specs', tags: ['api', 'docs'], scope: 'public', path: '~/.claude/skills/OpenAPI.md' },
  { id: 's8', name: 'DBMigrations', desc: 'Write and apply database migrations', tags: ['database', 'backend'], scope: 'project', path: './skills/DBMigrations.md' },
  { id: 's9', name: 'SecurityAudit', desc: 'Identify security vulnerabilities in code', tags: ['security', 'quality'], scope: 'public', path: '~/.claude/skills/SecurityAudit.md' },
  { id: 's10', name: 'PerfProfile', desc: 'Profile and optimize performance bottlenecks', tags: ['performance', 'backend'], scope: 'public', path: '~/.claude/skills/PerfProfile.md' },
];

const MOCK_AGENTS = [
  { id: 'a1', name: 'Architect', role: 'System design & architecture decisions', model: 'claude-opus-4-5', maxBudget: 10, color: '#7B6CF6', totalRuns: 47, totalCost: 34.82, skillIds: ['s5','s6','s7','s9'], systemPrompt: 'You are a senior software architect. Focus on maintainability, scalability, and clean interfaces. Always consider the broader system context before proposing changes. Prefer explicit over implicit. Document your reasoning.' },
  { id: 'a2', name: 'Coder', role: 'Feature implementation & bug fixes', model: 'claude-sonnet-4-5', maxBudget: 5, color: '#3FBA6E', totalRuns: 124, totalCost: 67.40, skillIds: ['s4','s5','s8'], systemPrompt: 'You are an expert software engineer. Write clean, idiomatic code. Follow existing patterns in the codebase. Always run tests after making changes. If unsure, ask for clarification before writing code.' },
  { id: 'a3', name: 'Reviewer', role: 'Code review & quality assurance', model: 'claude-sonnet-4-5', maxBudget: 3, color: '#C9961A', totalRuns: 83, totalCost: 21.15, skillIds: ['s4','s9','s6'], systemPrompt: 'You are a meticulous code reviewer. Check for correctness, security vulnerabilities, performance issues, and adherence to style guides. Provide specific, actionable feedback with line references.' },
  { id: 'a4', name: 'DocWriter', role: 'Documentation & API specs', model: 'claude-haiku-4-5', maxBudget: 2, color: '#4A9EE8', totalRuns: 38, totalCost: 4.22, skillIds: ['s1','s3','s6','s7'], systemPrompt: 'You are a technical writer. Produce clear, concise documentation targeted at developers. Use examples. Follow the existing doc style. Keep descriptions short and accurate.' },
];

const MOCK_TASKS = {
  'p1': [
    { id: 't1', title: 'Implement command palette ⌘K', desc: 'Add fuzzy search command palette with keyboard navigation, supporting project/agent/task actions', status: 'in-progress', agentId: 'a2', skillIds: ['s5'], activeRun: { id: 'r1', tokens: { input: 12400, output: 3820, cache: 8200 }, cost: 0.47, startedAt: Date.now() - 320000 }, lastRun: null, priority: 'high' },
    { id: 't2', title: 'Design token system + CSS vars', desc: 'Extract all design tokens to CSS custom properties. Document color, spacing, radius, shadow scales.', status: 'review', agentId: 'a1', skillIds: ['s2','s6'], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 900000 }, priority: 'medium' },
    { id: 't3', title: 'Add drag & drop to kanban', desc: 'Implement smooth drag-and-drop for task cards across columns. Include optimistic updates.', status: 'todo', agentId: null, skillIds: ['s5'], activeRun: null, lastRun: null, priority: 'high' },
    { id: 't4', title: 'WebSocket live token streaming', desc: 'Connect run console to WebSocket for real-time token count updates and log streaming.', status: 'todo', agentId: null, skillIds: ['s5'], activeRun: null, lastRun: null, priority: 'high' },
    { id: 't5', title: 'OpenAPI spec for REST endpoints', desc: 'Document all REST API endpoints with request/response schemas, auth, errors.', status: 'done', agentId: 'a4', skillIds: ['s7'], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 7200000 }, priority: 'medium' },
    { id: 't6', title: 'Security audit — agent execution', desc: 'Review sandboxing, prompt injection risks, and budget enforcement in task runner.', status: 'blocked', agentId: 'a3', skillIds: ['s9'], activeRun: null, lastRun: { status: 'fail', finishedAt: Date.now() - 3600000 }, priority: 'high', blockReason: 'Waiting for prod env access' },
    { id: 't7', title: 'Write E2E test suite', desc: 'Playwright tests for critical flows: create project, run task, cancel run, review output.', status: 'todo', agentId: null, skillIds: ['s4'], activeRun: null, lastRun: null, priority: 'low' },
    { id: 't8', title: 'Refactor task runner service', desc: 'Split monolithic TaskRunnerService into smaller, testable units. Improve error handling.', status: 'in-progress', agentId: 'a1', skillIds: ['s5','s4'], activeRun: { id: 'r2', tokens: { input: 5200, output: 890, cache: 3100 }, cost: 0.18, startedAt: Date.now() - 120000 }, lastRun: null, priority: 'medium' },
    { id: 't9', title: 'Add CLAUDE.md editor', desc: 'Monaco-based editor for CLAUDE.md files. Support global, per-project, per-agent scopes.', status: 'review', agentId: 'a2', skillIds: ['s2'], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 1800000 }, priority: 'medium' },
    { id: 't10', title: 'Fix token counter overflow', desc: 'Counter overflows at 99,999 tokens. Switch to abbreviated display (e.g. 1.2M).', status: 'done', agentId: 'a2', skillIds: [], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 14400000 }, priority: 'low' },
  ],
  'p2': [
    { id: 't11', title: 'Migrate to Tailwind v4', desc: 'Upgrade all components to Tailwind v4 config format.', status: 'in-progress', agentId: 'a2', skillIds: ['s5'], activeRun: { id: 'r3', tokens: { input: 9800, output: 2100, cache: 5000 }, cost: 0.31, startedAt: Date.now() - 600000 }, lastRun: null, priority: 'high' },
    { id: 't12', title: 'Color token audit', desc: 'Audit all hardcoded hex values and replace with semantic tokens.', status: 'todo', agentId: null, skillIds: ['s5'], activeRun: null, lastRun: null, priority: 'medium' },
    { id: 't13', title: 'Document component API', desc: 'Write JSDoc + Storybook stories for all 40 components.', status: 'review', agentId: 'a4', skillIds: ['s6'], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 5400000 }, priority: 'medium' },
  ],
  'p3': [
    { id: 't14', title: 'Auth middleware refactor', desc: 'Replace custom JWT middleware with passport.js strategy.', status: 'todo', agentId: null, skillIds: ['s5','s9'], activeRun: null, lastRun: null, priority: 'high' },
    { id: 't15', title: 'Rate limiting per-tenant', desc: 'Implement per-tenant rate limiting using Redis sliding window.', status: 'done', agentId: 'a1', skillIds: ['s8'], activeRun: null, lastRun: { status: 'ok', finishedAt: Date.now() - 28800000 }, priority: 'high' },
  ],
};

const MOCK_PROJECTS = [
  { id: 'p1', name: 'claude-cockpit', desc: 'Local agent orchestration dashboard', path: '~/dev/claude-cockpit', branch: 'main', lastActive: Date.now() - 180000 },
  { id: 'p2', name: 'design-system-v2', desc: 'Component library & token system', path: '~/dev/ds-v2', branch: 'feat/tokens-v2', lastActive: Date.now() - 7200000 },
  { id: 'p3', name: 'api-gateway', desc: 'REST gateway & auth service', path: '~/dev/api-gateway', branch: 'refactor/auth', lastActive: Date.now() - 86400000 },
];

const MOCK_CLAUDE_MDS = [
  { id: 'cm1', name: 'Global', scope: 'global', path: '~/.claude/CLAUDE.md', content: '# Global Instructions\n\nYou are working in a professional development environment.\n\n## Style\n- Use TypeScript for all new files\n- Prefer functional components in React\n- Follow existing code conventions\n\n## Commit messages\nUse conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`\n\n## Testing\nAlways write tests for new functionality.' },
  { id: 'cm2', name: 'claude-cockpit', scope: 'project', path: '~/dev/claude-cockpit/CLAUDE.md', content: '# Claude Cockpit Project\n\n## Stack\n- Next.js 15, React 19, TypeScript\n- Tailwind CSS + shadcn/ui\n- Prisma + SQLite (dev)\n\n## Architecture\nSee `/docs/architecture.md` for system design.\n\n## Key conventions\n- All agent runs go through `TaskRunnerService`\n- Never hardcode model names; use `AgentModel` enum' },
  { id: 'cm3', name: 'Coder agent', scope: 'agent', path: null, content: '# Coder Agent Context\n\nFocus on the `/src/services` and `/src/api` directories.\n\nPriority: correctness > performance > elegance.\n\nWhen editing existing files, preserve surrounding code style.' },
];

// Stream event templates for run simulation
const STREAM_EVENTS = [
  { type: 'text', content: 'Reading task description and understanding requirements...' },
  { type: 'tool', tool: 'bash', content: 'ls -la src/components/', result: 'CommandPalette.tsx  KanbanBoard.tsx  RunConsole.tsx  AgentEditor.tsx' },
  { type: 'tool', tool: 'readFile', content: 'src/components/CommandPalette.tsx', result: '// 247 lines read' },
  { type: 'text', content: 'I can see the existing structure. The command palette component needs fuzzy search and keyboard navigation. Let me implement this step by step.' },
  { type: 'tool', tool: 'bash', content: 'grep -r "useCommandPalette" src/', result: 'src/hooks/useCommandPalette.ts:  const [open, setOpen] = useState(false)' },
  { type: 'tool', tool: 'editFile', content: 'src/hooks/useCommandPalette.ts', result: 'Modified 3 lines' },
  { type: 'tool', tool: 'editFile', content: 'src/components/CommandPalette.tsx', result: 'Modified 47 lines' },
  { type: 'tool', tool: 'bash', content: 'npm run typecheck', result: '✓ No type errors found' },
  { type: 'text', content: 'Fuzzy search is working. Added keyboard navigation with ArrowUp/ArrowDown/Enter. The palette now supports project switching, running tasks, and common actions.' },
  { type: 'tool', tool: 'bash', content: 'npm run test -- --grep CommandPalette', result: '✓ 8 tests passed (1.2s)' },
  { type: 'text', content: 'All tests passing. The implementation is complete.' },
];

window.MOCK_DATA = { MOCK_SKILLS, MOCK_AGENTS, MOCK_TASKS, MOCK_PROJECTS, MOCK_CLAUDE_MDS, STREAM_EVENTS };
