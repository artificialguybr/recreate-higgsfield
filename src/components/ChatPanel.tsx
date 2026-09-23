import { useEffect, useRef, useState } from "react";
import { chatCommand, ChatCtx } from "../lib/editorChat";
import { Spark, ArrowUp } from "./Icons";

type Msg = { id: number; role: "user" | "ai"; text: string; followups?: string[] };

let n = 0;

const SUGGESTIONS = ["status", 'caption "Made with Field"', "speed 1.5×", "add first"];

export default function ChatPanel({ ctx }: { ctx: ChatCtx }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: -1,
      role: "ai",
      text: "I edit through the same timeline as you — everything I do shows up live and undoes with ⌘Z. Try one of these, or ask in plain words.",
      followups: SUGGESTIONS,
    },
  ]);
  const [val, setVal] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, thinking]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy.current) return;
    busy.current = true;
    setMsgs((m) => [...m, { id: ++n, role: "user", text }]);
    setVal("");
    setThinking(true);
    // a beat, so the edit reads as an action, not an accident
    setTimeout(() => {
      const out = chatCommand(text, ctx);
      setThinking(false);
      setMsgs((m) => [...m, { id: ++n, role: "ai", text: out.reply, followups: out.followups }]);
      busy.current = false;
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
