import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Clock, Film, VideoIc, X } from "../components/Icons";
import {
  approveLaunchframePlan,
  chatWithLaunchframe,
  createLaunchframePlan,
  exportLaunchframeWorkflow,
  getLaunchframeWorkflow,
  launchframeMediaUrl,
  patchLaunchframeLayers,
  startLaunchframeWorkflow,
  type LaunchframeChatMessage,
  type LaunchframeLayer,
  type LaunchframeProfile,
  type LaunchframeVideoType,
  type LaunchframeWorkflow,
} from "../lib/launchframe";
import { upsertWorkspaceArtifact } from "../lib/workspace";
import { setPending } from "../lib/transfer";

type Stage = "brief" | "plan" | "run" | "layers";
type ApiState = "unknown" | "online" | "offline";

type VideoTypeOption = {
  id: LaunchframeVideoType;
  title: string;
  description: string;
  duration: string;
  cost: string;
};

const VIDEO_TYPES: VideoTypeOption[] = [
  { id: "A", title: "Flash demo", description: "Real product UI, sharp cuts, kinetic type.", duration: "20–30s", cost: "No AI cost" },
  { id: "B", title: "Narrated demo", description: "Founder voice and video over the workflow.", duration: "60–90s", cost: "Founder media" },
  { id: "C", title: "Concept story", description: "Product demo with cinematic Higgsfield b-roll.", duration: "30–45s", cost: "Seedance usage" },
];

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "brief", label: "Brief" },
  { id: "plan", label: "Plan" },
  { id: "run", label: "Produce" },
  { id: "layers", label: "Polish" },
];

const STAGE_LABELS: Record<string, string> = {
  capture: "Capture product",
  generate: "Generate shots",
  budget: "Check budget",
  assemble: "Assemble video",
  done: "Ready",
};

const INITIAL_ASSISTANT: LaunchframeChatMessage = {
  role: "assistant",
  content: "Paste a product URL and I’ll help shape the launch story before anything runs.",
};

function fileToBase64(file: File | undefined): Promise<string | undefined> {
  if (!file) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}

function totalLayerDuration(layers: LaunchframeLayer[]): number {
  return layers.reduce((sum, layer) => sum + layer.duration, 0);
}

function stageIndex(stage: Stage): number {
  return STAGES.findIndex((item) => item.id === stage);
}


function kindLabel(kind: LaunchframeLayer["kind"]): string {
  if (kind === "higgsfield") return "AI b-roll";
  if (kind === "ui") return "Product UI";
  if (kind === "text") return "Title card";
  if (kind === "audio") return "Audio";
  return kind;
}

function profileReason(profile: LaunchframeProfile | undefined): string | null {
  return profile?.reasons?.[0] ?? null;
}

export default function Launchframe() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("brief");
  const [url, setUrl] = useState("");
  const [videoType, setVideoType] = useState<LaunchframeVideoType>("A");
  const [instruction, setInstruction] = useState("");
  const [budget, setBudget] = useState("2");
  const [founderVideo, setFounderVideo] = useState<File>();
  const [founderVoice, setFounderVoice] = useState<File>();
  const [logo, setLogo] = useState<File>();
  const [consent, setConsent] = useState(false);
  const [workflow, setWorkflow] = useState<LaunchframeWorkflow | null>(null);
  const [draftLayers, setDraftLayers] = useState<LaunchframeLayer[]>([]);
  const [removedLayerIds, setRemovedLayerIds] = useState<string[]>([]);
  const [assistant, setAssistant] = useState<LaunchframeChatMessage[]>([INITIAL_ASSISTANT]);
  const [assistantInput, setAssistantInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [apiState, setApiState] = useState<ApiState>("unknown");
  const reportedStatus = useRef<string>("");
  const assistantEnd = useRef<HTMLDivElement | null>(null);

  const selectedType = useMemo(() => VIDEO_TYPES.find((item) => item.id === videoType) ?? VIDEO_TYPES[0], [videoType]);
  const layers = draftLayers.length ? draftLayers : workflow?.layers ?? [];
  const totalDuration = totalLayerDuration(layers);
  const activeIndex = stageIndex(stage);

  useEffect(() => {
    assistantEnd.current?.scrollIntoView({ block: "nearest" });
  }, [assistant]);

  useEffect(() => {
    if (stage !== "run" || !workflow?.id || workflow.status === "complete" || workflow.status === "failed") return;
    let live = true;
    const poll = async () => {
      try {
        const next = await getLaunchframeWorkflow(workflow.id);
        if (!live) return;
        setWorkflow(next);
        setDraftLayers(next.layers);
        if (next.status === "complete") {
          upsertWorkspaceArtifact({
            id: "launch",
            tool: "launch",
            title: next.plan?.title || "Launchframe",
            summary: "First cut ready. Open Polish to edit the layers.",
            route: "/launch",
            status: "ready",
            outputUrl: next.videoUrl ? launchframeMediaUrl(next.videoUrl) : undefined,
            outputKind: next.videoUrl ? "video" : undefined,
            outputSource: next.videoUrl ? "generation" : undefined,
          });
        }
        if (reportedStatus.current !== next.status) {
          reportedStatus.current = next.status;
          setAssistant((messages) => [...messages, {
            role: "assistant",
            content: next.status === "complete" ? "The first cut is ready. Open the layer pass when you want to polish it." : `The workflow stopped: ${next.error || "the server returned a failure"}`,
          }]);
        }
      } catch (pollError) {
        if (live) setError(pollError instanceof Error ? pollError.message : "Could not read workflow status");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [stage, workflow?.id, workflow?.status]);

  const showError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "Something went wrong");
    setApiState("offline");
  };

  const buildPlan = async () => {
    setError("");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      setError("Enter a complete product URL, including https://");
      return;
    }
    if (videoType === "B" && (!founderVideo || !founderVoice || !consent)) {
      setError("Narrated demos need founder video, founder voice, and consent.");
      return;
    }
    setBusy(true);
    try {
      const [founderVideoBase64, founderVoiceBase64, logoBase64] = await Promise.all([
        fileToBase64(founderVideo),
        fileToBase64(founderVoice),
        fileToBase64(logo),
      ]);
      const next = await createLaunchframePlan({
        url: parsedUrl.toString(),
        videoType,
        instruction: instruction.trim() || undefined,
        maxBudget: Math.max(0, Number(budget) || 0),
        founderVideoBase64,
        founderVoiceBase64,
        logoBase64,
        consent,
      });
      setWorkflow(next);
      setDraftLayers(next.layers);
      upsertWorkspaceArtifact({
        id: "launch",
        tool: "launch",
        title: next.plan?.title || `Launch ${parsedUrl.hostname}`,
        summary: `${next.plan?.beats.length ?? 0} beats ready for review.`,
        route: "/launch",
        status: "active",
      });
      setStage("plan");
      setApiState("online");
      setAssistant((messages) => [...messages, { role: "assistant", content: `Plan ready for ${next.plan?.title || parsedUrl.hostname}. Review the beats, API calls, and budget before approval.` }]);
    } catch (buildError) {
      showError(buildError);
    } finally {
      setBusy(false);
    }
  };

  const approveAndStart = async () => {
    if (!workflow) return;
    setBusy(true);
    setError("");
    try {
      const approved = await approveLaunchframePlan(workflow.id, Math.max(0, Number(budget) || 0));
      const started = await startLaunchframeWorkflow(workflow.id);
      setWorkflow((current) => current ? { ...current, ...approved, ...started, status: "running" } : current);
      setStage("run");
      setApiState("online");
      setAssistant((messages) => [...messages, { role: "assistant", content: "Approved. Production is running; I’ll keep the stage status here." }]);
    } catch (approveError) {
      showError(approveError);
    } finally {
      setBusy(false);
    }
  };

  const openLayers = () => {
    if (!workflow) return;
    setDraftLayers(workflow.layers);
    setRemovedLayerIds([]);
    setStage("layers");
  };

  const updateLayer = (id: string, patch: Partial<LaunchframeLayer>) => {
    setDraftLayers((current) => current.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
  };

  const moveLayer = (index: number, direction: -1 | 1) => {
    setDraftLayers((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((layer, order) => ({ ...layer, order }));
    });
  };

  const removeLayer = (id: string) => {
    setRemovedLayerIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    setDraftLayers((current) => current.filter((layer) => layer.id !== id).map((layer, order) => ({ ...layer, order })));
  };

  const exportLayers = async () => {
    if (!workflow || !layers.length) return;
    setExporting(true);
    setError("");
    try {
      const edits = [
        ...layers.map((layer, order) => ({ id: layer.id, order, duration: layer.duration, text: layer.text, removed: false })),
        ...removedLayerIds.map((id) => ({ id, removed: true })),
      ];
      const patched = await patchLaunchframeLayers(workflow.id, edits);
      const exported = await exportLaunchframeWorkflow(workflow.id);
      const next = { ...workflow, ...patched, status: "complete" as const, videoUrl: exported.videoUrl };
      setWorkflow(next);
      setDraftLayers(next.layers);
      setRemovedLayerIds([]);
      setExporting(false);
      setAssistant((messages) => [...messages, { role: "assistant", content: "New cut exported from the edited layer stack." }]);
    } catch (exportError) {
      showError(exportError);
      setExporting(false);
    }
  };

  const openEditor = () => {
    if (!workflow?.videoUrl) return;
    setPending(launchframeMediaUrl(workflow.videoUrl), "video");
    navigate("/editor");
  };

  const submitAssistant = async (message = assistantInput) => {
    const content = message.trim();
    if (!content || assistantBusy) return;
    const nextMessage: LaunchframeChatMessage = { role: "user", content };
    const nextHistory = [...assistant, nextMessage];
    setAssistant(nextHistory);
    setAssistantInput("");
    setAssistantBusy(true);
    try {
      const response = await chatWithLaunchframe({ url: url.trim() || workflow?.url, workflowId: workflow?.id, message: content, history: nextHistory });
      setAssistant((messages) => [...messages, { role: "assistant", content: response.reply }]);
      setApiState("online");
    } catch (chatError) {
      setAssistant((messages) => [...messages, { role: "assistant", content: chatError instanceof Error ? chatError.message : "The Launchframe guide is offline." }]);
      setApiState("offline");
    } finally {
      setAssistantBusy(false);
    }
  };

  const resetToBrief = () => {
    setStage("brief");
    setWorkflow(null);
    setDraftLayers([]);
    setRemovedLayerIds([]);
    setError("");
    reportedStatus.current = "";
  };

  return (
    <div className="app-scroll launch-scroll">
      <div className="launch-page">
        <header className="launch-head">
          <h1>Launch a product video.</h1>
          <p>Start with a product URL. Review the story and approve production before anything runs.</p>
        </header>

        <nav className="launch-steps" aria-label="Launchframe workflow">
          {STAGES.map((item, index) => <div key={item.id} className={`launch-step${index === activeIndex ? " on" : ""}${index < activeIndex ? " done" : ""}`}><span>{index < activeIndex ? <Check size={12} /> : index + 1}</span><b>{item.label}</b></div>)}
        </nav>

        <div className="launch-layout">
          <main className="launch-main">
            {stage === "brief" && <BriefStage url={url} setUrl={setUrl} videoType={videoType} setVideoType={setVideoType} selectedType={selectedType} instruction={instruction} setInstruction={setInstruction} budget={budget} setBudget={setBudget} founderVideo={founderVideo} setFounderVideo={setFounderVideo} founderVoice={founderVoice} setFounderVoice={setFounderVoice} logo={logo} setLogo={setLogo} consent={consent} setConsent={setConsent} busy={busy} error={error} onBuild={buildPlan} />}
            {stage === "plan" && workflow?.plan && <PlanStage workflow={workflow} budget={budget} setBudget={setBudget} busy={busy} error={error} onBack={resetToBrief} onApprove={approveAndStart} />}
            {stage === "run" && workflow && <RunStage workflow={workflow} error={error} onBack={() => setStage("plan")} onLayers={openLayers} onEditor={openEditor} />}
            {stage === "layers" && workflow && <LayersStage workflow={workflow} layers={layers} totalDuration={totalDuration} exporting={exporting} error={error} onBack={() => setStage("run")} onUpdate={updateLayer} onMove={moveLayer} onRemove={removeLayer} onExport={exportLayers} onEditor={openEditor} />}
          </main>

          <aside className="launch-aside">
            <div className="launch-context">
              <div className="launch-context-head"><span>Workflow</span><span className={`launch-dot ${workflow?.status || "idle"}`} /></div>
              <strong>{workflow?.plan?.title || "No production yet"}</strong>
              <span>{workflow ? `${workflow.plan?.videoType ? `Type ${workflow.plan.videoType}` : "Draft"} · ${workflow.plan?.beats.length || 0} beats` : "Your plan will appear here"}</span>
              {workflow?.profile && <p>{profileReason(workflow.profile)}</p>}
            </div>
            <div className="launch-assistant">
              <div className="launch-assistant-head"><div><b>Field guide</b><span>grounded in your product</span></div><VideoIc size={15} /></div>
              <div className="launch-chatlog">
                {assistant.map((message, index) => <div key={`${message.role}-${index}`} className={`launch-message ${message.role}`}>{message.content}</div>)}
                {assistantBusy && <div className="launch-message assistant launch-thinking"><i /><i /><i /></div>}
                <div ref={assistantEnd} />
              </div>
              <div className="launch-suggestions"><button onClick={() => void submitAssistant("Which video type fits this product?")}>Which type fits?</button><button onClick={() => void submitAssistant("How does the budget approval work?")}>Explain the budget</button></div>
              <form className="launch-chat-input" onSubmit={(event) => { event.preventDefault(); void submitAssistant(); }}><input value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask about the launch…" disabled={assistantBusy} /><button aria-label="Send" disabled={assistantBusy || !assistantInput.trim()}><ArrowRight size={14} /></button></form>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

type BriefProps = {
  url: string;
  setUrl: (value: string) => void;
  videoType: LaunchframeVideoType;
  setVideoType: (value: LaunchframeVideoType) => void;
  selectedType: VideoTypeOption;
  instruction: string;
  setInstruction: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  founderVideo?: File;
  setFounderVideo: (value: File | undefined) => void;
  founderVoice?: File;
  setFounderVoice: (value: File | undefined) => void;
  logo?: File;
  setLogo: (value: File | undefined) => void;
  consent: boolean;
  setConsent: (value: boolean) => void;
  busy: boolean;
  error: string;
  onBuild: () => void;
};

function BriefStage(props: BriefProps) {
  const fileName = (file?: File) => file?.name || "Choose file";
  return (
    <section className="launch-card">
      <div className="launch-card-head"><div><span className="launch-kicker">Step 1 · Brief</span><h2>Start with your product URL.</h2></div><span className="launch-card-note">No production starts before approval.</span></div>
      <label className="launch-label">Product URL<input value={props.url} onChange={(event) => props.setUrl(event.target.value)} placeholder="https://yourproduct.com" type="url" autoComplete="url" /></label>
      <div className="launch-label">Video shape<div className="launch-types">{VIDEO_TYPES.map((item) => <button key={item.id} className={`launch-type${props.videoType === item.id ? " on" : ""}`} onClick={() => props.setVideoType(item.id)} type="button"><span className="launch-type-top"><span className="launch-type-code">{item.id}</span><b>{item.title}</b><span className="launch-type-check">{props.videoType === item.id ? <Check size={12} /> : null}</span></span><span>{item.description}</span><small>{item.duration} · {item.cost}</small></button>)}</div></div>
      {props.videoType === "B" && <div className="launch-founder"><span className="launch-label">Founder media <em>required for narrated demos</em></span><div className="launch-file-grid"><FileInput label="Founder video" accept="video/*" file={props.founderVideo} setFile={props.setFounderVideo} fileName={fileName(props.founderVideo)} /><FileInput label="Founder voice" accept="audio/*" file={props.founderVoice} setFile={props.setFounderVoice} fileName={fileName(props.founderVoice)} /><FileInput label="Logo" accept="image/*" file={props.logo} setFile={props.setLogo} fileName={fileName(props.logo)} /></div><label className="launch-consent"><input checked={props.consent} onChange={(event) => props.setConsent(event.target.checked)} type="checkbox" /> I consent to founder media being processed and deleted after production.</label></div>}
      <label className="launch-label">Creative direction <span>optional</span><textarea value={props.instruction} onChange={(event) => props.setInstruction(event.target.value)} placeholder="Lead with the 10× speed claim. End with a clear invitation." maxLength={2000} /></label>
      <div className="launch-bottom-row"><label className="launch-label launch-budget">Max budget <span>USD ceiling</span><input value={props.budget} onChange={(event) => props.setBudget(event.target.value)} min="0" max="50" step="0.5" type="number" /></label><div className="launch-action"><span>{props.selectedType.duration} · {props.selectedType.cost}</span><button className="launch-primary" disabled={props.busy} onClick={props.onBuild}>{props.busy ? "Building plan…" : "Build production plan"}<ArrowRight size={15} /></button></div></div>
      {props.error && <div className="launch-error">{props.error}</div>}
    </section>
  );
}

type FileInputProps = { label: string; accept: string; file?: File; setFile: (value: File | undefined) => void; fileName: string };
function FileInput({ label, accept, setFile, fileName }: FileInputProps) {
  return <label className="launch-file"><span>{label}</span><input accept={accept} onChange={(event) => setFile(event.target.files?.[0])} type="file" /><strong>{fileName}</strong></label>;
}

type PlanProps = { workflow: LaunchframeWorkflow; budget: string; setBudget: (value: string) => void; busy: boolean; error: string; onBack: () => void; onApprove: () => void };
function PlanStage({ workflow, budget, setBudget, busy, error, onBack, onApprove }: PlanProps) {
  const plan = workflow.plan;
  if (!plan) return null;
  return <section className="launch-card"><div className="launch-card-head"><div><span className="launch-kicker">Step 2 · Plan</span><h2>{plan.title}</h2></div><span className="launch-card-note">{workflow.usedFixture ? "Fixture capture" : "Real capture"}</span></div><div className="launch-plan-intro"><span className="launch-plan-type">Type {plan.videoType}</span><strong>{plan.hook}</strong><span>{plan.beats.length} beats · {plan.apiChoices.length} API calls · approve before any generation</span></div><div className="launch-section-label">Story beats</div><div className="launch-beats">{plan.beats.map((beat, index) => <div className="launch-beat" key={`${beat.type}-${index}`}><span className="launch-beat-index">{String(index + 1).padStart(2, "0")}</span><div><b>{beat.type}</b><p>{beat.text}</p></div><span className="launch-beat-duration">{formatDuration(beat.duration)}{beat.requiresAI ? " · AI" : ""}</span></div>)}</div><div className="launch-section-label">Verified Higgsfield calls</div><div className="launch-api-list">{plan.apiChoices.length ? plan.apiChoices.map((choice) => <div className="launch-api" key={choice.id}><div><b>{choice.model}</b><span>{choice.endpoint}</span><p>{choice.purpose}</p></div><strong>${choice.estimatedCost.toFixed(2)}</strong></div>) : <div className="launch-empty">No paid generation required for this type.</div>}</div><div className="launch-approval"><div><span>Estimated</span><strong>${plan.estimatedCost.toFixed(2)}</strong><small>Budget ceiling</small><input value={budget} onChange={(event) => setBudget(event.target.value)} min="0" max="50" step="0.5" type="number" /></div><button className="launch-primary" disabled={busy} onClick={onApprove}>{busy ? "Starting…" : "Approve & produce"}<ArrowRight size={15} /></button></div><div className="launch-card-actions"><button className="launch-quiet" onClick={onBack}><ArrowLeft size={14} /> Change brief</button></div>{error && <div className="launch-error">{error}</div>}</section>;
}

type RunProps = { workflow: LaunchframeWorkflow; error: string; onBack: () => void; onLayers: () => void; onEditor: () => void };
function RunStage({ workflow, error, onBack, onLayers, onEditor }: RunProps) {
  const isComplete = workflow.status === "complete";
  const isFailed = workflow.status === "failed";
  const progress = Math.max(0, Math.min(100, workflow.progress || 0));
  return <section className="launch-card launch-run"><div className="launch-card-head"><div><span className="launch-kicker">Step 3 · Produce</span><h2>{isComplete ? "Your first cut is ready." : isFailed ? "Production stopped." : "Building the first cut."}</h2></div><span className={`launch-status-pill ${isComplete ? "complete" : isFailed ? "failed" : "running"}`}><span />{isComplete ? "Complete" : isFailed ? "Failed" : "Live"}</span></div>{isComplete && workflow.videoUrl ? <video className="launch-video" controls playsInline src={launchframeMediaUrl(workflow.videoUrl)} /> : <div className="launch-progress"><strong>{progress}%</strong><span>{workflow.status === "approved" ? "Starting production…" : "Working through the approved plan…"}</span><div className="launch-progress-track"><i style={{ width: `${progress}%` }} /></div><div className="launch-progress-steps">{["capture", "generate", "budget", "assemble", "done"].map((step) => <div key={step} className={`launch-progress-step${workflow.transcript.some((item) => item.step === step) ? " done" : ""}`}><span>{workflow.transcript.some((item) => item.step === step) ? <Check size={11} /> : <Clock size={11} />}</span>{STAGE_LABELS[step]}</div>)}</div></div>}{isFailed && <div className="launch-error">{workflow.error || error || "The workflow failed at an unknown stage."}</div>}<div className="launch-transcript">{workflow.transcript.map((item, index) => <div key={`${item.step}-${index}`}><b>{item.step}</b><span>{item.detail}</span></div>)}</div><div className="launch-card-actions"><button className="launch-quiet" onClick={onBack}><ArrowLeft size={14} /> Back to plan</button>{isComplete && <><button className="launch-secondary" onClick={onLayers}><Film size={14} /> Edit layers</button><button className="launch-primary small" onClick={onEditor}>Open in Editor <ArrowRight size={14} /></button></>}</div>{error && !isFailed && <div className="launch-error">{error}</div>}</section>;
}

type LayersProps = { workflow: LaunchframeWorkflow; layers: LaunchframeLayer[]; totalDuration: number; exporting: boolean; error: string; onBack: () => void; onUpdate: (id: string, patch: Partial<LaunchframeLayer>) => void; onMove: (index: number, direction: -1 | 1) => void; onRemove: (id: string) => void; onExport: () => void; onEditor: () => void };
function LayersStage({ workflow, layers, totalDuration, exporting, error, onBack, onUpdate, onMove, onRemove, onExport, onEditor }: LayersProps) {
  return <section className="launch-card launch-layers"><div className="launch-card-head"><div><span className="launch-kicker">Step 4 · Polish</span><h2>Shape the final cut.</h2></div><span className="launch-card-note">{layers.length} layers · {formatDuration(totalDuration)}</span></div><p className="launch-description">Reorder, retime, retitle, or remove. The backend reassembles the MP4 from this stack.</p><div className="launch-layer-list">{layers.map((layer, index) => <div className="launch-layer" key={layer.id}><span className="launch-layer-grip">{String(index + 1).padStart(2, "0")}</span><div className="launch-layer-body"><div><span className="launch-layer-kind">{kindLabel(layer.kind)}</span><b>{layer.label}</b></div><input value={layer.text || ""} onChange={(event) => onUpdate(layer.id, { text: event.target.value })} placeholder="Layer text" /><span className="launch-layer-source">{layer.source ? "Source attached" : "Generated from plan"}</span></div><label className="launch-layer-duration"><span>Seconds</span><input value={layer.duration} onChange={(event) => onUpdate(layer.id, { duration: Math.max(0.5, Math.min(30, Number(event.target.value) || 0.5)) })} min="0.5" max="30" step="0.5" type="number" /></label><div className="launch-layer-actions"><button disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move layer up"><ArrowLeft size={13} /></button><button disabled={index === layers.length - 1} onClick={() => onMove(index, 1)} aria-label="Move layer down"><ArrowRight size={13} /></button><button onClick={() => onRemove(layer.id)} aria-label="Remove layer"><X size={13} /></button></div></div>)}</div>{workflow.videoUrl && <video className="launch-video" controls playsInline src={launchframeMediaUrl(workflow.videoUrl)} />}{error && <div className="launch-error">{error}</div>}<div className="launch-card-actions"><button className="launch-quiet" onClick={onBack}><ArrowLeft size={14} /> Back to cut</button><button className="launch-secondary" onClick={onEditor} disabled={!workflow.videoUrl}><Film size={14} /> Continue in Editor</button><button className="launch-primary" onClick={onExport} disabled={exporting || !layers.length}>{exporting ? "Exporting…" : "Apply edits & export"}<ArrowRight size={14} /></button></div></section>;
}
