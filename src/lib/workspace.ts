export type WorkspaceTool = "brief" | "chat" | "launch" | "studio" | "editor" | "export" | "gallery" | "image" | "video" | "audio" | "3d" | "motion-control" | "motion-transfer" | "stock";
export type WorkspaceStatus = "ready" | "active" | "draft" | "empty" | "failed";
export type WorkspacePositions = Record<string, { x: number; y: number }>;
export type WorkspaceConnection = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string };

export interface WorkspaceArtifact {
  id: string;
  tool: WorkspaceTool;
  title: string;
  summary: string;
  route: string;
  status: WorkspaceStatus;
  updatedAt: string;
  prompt?: string;
  generationPrompt?: string;
  model?: string;
  outputUrl?: string;
  outputKind?: "image" | "video" | "audio" | "3d";
  outputSource?: "catalog" | "generation" | "render";
  assetId?: string;
  resolution?: "480p" | "720p";
  parameters?: Record<string, string | number | boolean>;
}

export interface WorkspaceProject {
  id: string;
  title: string;
  artifacts: WorkspaceArtifact[];
  positions: WorkspacePositions;
  edges?: WorkspaceConnection[];
}
function withoutSeedEdges(edges: WorkspaceConnection[]): WorkspaceConnection[] {
  // Older auto-wiring used tool IDs; React Flow assigns xy-edge__ IDs to manual links.
  return edges.filter((edge) => edge.id.startsWith("xy-edge__"));
}

const KEY = "field-workspace-artifacts";
const TITLE_KEY = "field-workspace-title";
const POSITIONS_KEY = "field-workspace-positions";
const PROJECTS_KEY = "field-workspace-projects";
const EDGES_KEY = "field-workspace-edges";
const ACTIVE_KEY = "field-workspace-active-project";

const DEFAULT_ARTIFACTS: WorkspaceArtifact[] = [
  { id: "brief", tool: "brief", title: "Project brief", summary: "The shared starting point for this project.", route: "/", status: "ready", updatedAt: "" },
  { id: "chat", tool: "chat", title: "Field Chat", summary: "Explore ideas, prompts, and first takes.", route: "/chat", status: "empty", updatedAt: "" },
  { id: "launch", tool: "launch", title: "Launchframe", summary: "Turn a product URL into an approved launch video.", route: "/launch", status: "empty", updatedAt: "" },
  { id: "image", tool: "image", title: "Image", summary: "Generate or refine a still.", route: "/image", status: "draft", updatedAt: "" },
  { id: "video", tool: "video", title: "Video", summary: "Generate a moving shot.", route: "/video", status: "draft", updatedAt: "" },
  { id: "stock", tool: "stock", title: "Stock footage", summary: "Find free Pexels footage for b-roll.", route: "/video", status: "empty", updatedAt: "" },
];

function cloneDefaults(): WorkspaceArtifact[] {
  return DEFAULT_ARTIFACTS.map((artifact) => ({ ...artifact }));
}

function mergeDefaults(saved: WorkspaceArtifact[]): WorkspaceArtifact[] {
  const byId = new Map(saved.map((artifact) => [artifact.id, artifact]));
  const known = new Set(DEFAULT_ARTIFACTS.map((artifact) => artifact.id));
  return [...DEFAULT_ARTIFACTS.map((artifact) => ({ ...artifact, ...(byId.get(artifact.id) ?? {}) })), ...saved.filter((artifact) => !known.has(artifact.id))];
}

function storedArtifacts(): WorkspaceArtifact[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(value) ? value as WorkspaceArtifact[] : null;
  } catch {
    return null;
  }
}

function readProjects(): WorkspaceProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
    return Array.isArray(value) ? value as WorkspaceProject[] : [];
  } catch {
    return [];
  }
}

function writeProjects(projects: WorkspaceProject[]) {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch { /* Keep the current project usable without storage. */ }
}

function readPositions(): WorkspacePositions {
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) || "{}") as WorkspacePositions; } catch { return {}; }
}

function readEdges(): WorkspaceConnection[] {
  try {
    const value = JSON.parse(localStorage.getItem(EDGES_KEY) || "[]");
    return Array.isArray(value) ? withoutSeedEdges(value as WorkspaceConnection[]) : [];
  } catch { return []; }
}

function ensureProjects(): WorkspaceProject[] {
  let projects = readProjects();
  if (!projects.length) {
    projects = [{
      id: "project-default",
      title: localStorage.getItem(TITLE_KEY) || "Untitled project",
      artifacts: mergeDefaults(storedArtifacts() ?? cloneDefaults()),
      positions: readPositions(),
      edges: readEdges(),
    }];
    writeProjects(projects);
  }
  if (!projects.some((project) => project.id === localStorage.getItem(ACTIVE_KEY))) {
    localStorage.setItem(ACTIVE_KEY, projects[0].id);
  }
  return projects;
}

function syncActive(projects = ensureProjects()): WorkspaceProject[] {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  return projects.map((project) => project.id === activeId ? {
    ...project,
    title: localStorage.getItem(TITLE_KEY) ?? project.title,
    artifacts: storedArtifacts() ? mergeDefaults(storedArtifacts()!) : project.artifacts,
    positions: readPositions(),
    edges: readEdges(),
  } : project);
}

export function readWorkspacePositions(): WorkspacePositions {
  ensureProjects();
  return readPositions();
}

export function readWorkspaceEdges(): WorkspaceConnection[] | null {
  ensureProjects();
  try {
    const value = localStorage.getItem(EDGES_KEY);
    if (value === null) return null;
    const edges = JSON.parse(value);
    return Array.isArray(edges) ? withoutSeedEdges(edges as WorkspaceConnection[]) : [];
  } catch {
    return [];
  }
}

export function readWorkspaceArtifacts(): WorkspaceArtifact[] {
  return mergeDefaults(storedArtifacts() ?? cloneDefaults());
}

export function saveWorkspaceArtifacts(artifacts: WorkspaceArtifact[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(artifacts)); } catch { /* Workspace remains usable when storage is unavailable. */ }
  writeProjects(syncActive());
}

export function saveWorkspaceTitle(title: string): void {
  localStorage.setItem(TITLE_KEY, title);
  writeProjects(syncActive());
}

export function saveWorkspacePositions(positions: WorkspacePositions): void {
  try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)); } catch { /* Position persistence is optional. */ }
  writeProjects(syncActive());
}

export function saveWorkspaceEdges(edges: WorkspaceConnection[]): void {
  try { localStorage.setItem(EDGES_KEY, JSON.stringify(edges)); } catch { /* Connections remain usable until refresh. */ }
  writeProjects(syncActive());
}

export function listWorkspaceProjects(): Pick<WorkspaceProject, "id" | "title">[] {
  return syncActive().map(({ id, title }) => ({ id, title }));
}

export function activeWorkspaceProjectId(): string {
  ensureProjects();
  return localStorage.getItem(ACTIVE_KEY) || "project-default";
}

export function createWorkspaceProject(): WorkspaceProject {
  const projects = syncActive();
  const project: WorkspaceProject = { id: `project-${Date.now().toString(36)}`, title: "Untitled project", artifacts: cloneDefaults(), positions: {}, edges: [] };
  localStorage.setItem(ACTIVE_KEY, project.id);
  localStorage.setItem(TITLE_KEY, project.title);
  localStorage.setItem(KEY, JSON.stringify(project.artifacts));
  localStorage.setItem(POSITIONS_KEY, "{}");
  localStorage.setItem(EDGES_KEY, "[]");
  writeProjects([...projects, project]);
  return project;
}

export function openWorkspaceProject(id: string): WorkspaceProject | null {
  const projects = syncActive();
  const project = projects.find((item) => item.id === id);
  if (!project) return null;
  localStorage.setItem(ACTIVE_KEY, project.id);
  localStorage.setItem(TITLE_KEY, project.title);
  const artifacts = mergeDefaults(project.artifacts);
  localStorage.setItem(KEY, JSON.stringify(artifacts));
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(project.positions));
  const edges = withoutSeedEdges(project.edges ?? []);
  localStorage.setItem(EDGES_KEY, JSON.stringify(edges));
  writeProjects(projects);
  return { ...project, artifacts, edges };
}

export function upsertWorkspaceArtifact(
  patch: Pick<WorkspaceArtifact, "id" | "tool" | "title" | "summary" | "route" | "status"> & Partial<Pick<WorkspaceArtifact, "prompt" | "generationPrompt" | "model" | "outputUrl" | "outputKind" | "outputSource" | "assetId" | "resolution" | "parameters">>,
): WorkspaceArtifact[] {
  const current = readWorkspaceArtifacts();
  const index = current.findIndex((artifact) => artifact.id === patch.id);
  const next = index < 0
    ? [{ ...patch, updatedAt: new Date().toISOString() }, ...current]
    : current.map((artifact) => artifact.id === patch.id ? { ...artifact, ...patch, updatedAt: new Date().toISOString() } : artifact);
  saveWorkspaceArtifacts(next);
  return next;
}

