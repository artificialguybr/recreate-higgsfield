import { useEffect, useRef, useState } from "react";
import { chatCommand, ChatCtx } from "../lib/editorChat";
import { Spark, ArrowUp } from "./Icons";

type Msg = { id: number; role: "user" | "ai"; text: string; followups?: string[] };


const SUGGESTIONS = ["status", 'caption "Made with Field"', "speed 1.5×", "add first"];

export default function ChatPanel({ ctx }: { ctx: ChatCtx }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: -1,
      role: "ai",
      text: "Edits appear on the timeline immediately and undo with ⌘Z. Type “help” to see the available commands.",
      followups: SUGGESTIONS,
    },
  ]);
  const [val, setVal] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);
  const nextId = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, thinking]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy.current) return;
    busy.current = true;
    setMsgs((m) => [...m, { id: ++nextId.current, role: "user", text }]);
    setVal("");
    setThinking(true);
    timer.current = window.setTimeout(() => {
      const out = chatCommand(text, ctx);
      setThinking(false);
      setMsgs((m) => [...m, { id: ++nextId.current, role: "ai", text: out.reply, followups: out.followups }]);
      busy.current = false;
      timer.current = null;
    }, 450);
  };

  return (
    <div className="edchat">
      <div className="edchat-head">
        <span className="edchat-title">
          <Spark size={13} /> Editor Chat
        </span>
        <span className="edchat-sub">live · undoable</span>
      </div>
      <div className="edchat-thread">
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {thinking && (
          <div className="bubble ai thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {!thinking && msgs[msgs.length - 1]?.followups && (
          <div className="follows">
            {msgs[msgs.length - 1]!.followups!.map((f) => (
              <button key={f} className="chip" onClick={() => send(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="edchat-input">
        <input
          value={val}
          placeholder='e.g. "split", "fade it", "export"'
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(val)}
        />
        <button className="send-key" onClick={() => send(val)} disabled={!val.trim() || thinking} aria-label="Send">
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}
