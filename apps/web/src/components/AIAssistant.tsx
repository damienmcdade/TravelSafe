"use client";
import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "travelsafe.assistant.v1";
const INTRO: Message = {
  role: "assistant",
  content: "Hi — I can answer questions about the US cities and counties TravelSafe tracks, their neighborhoods, and how they compare to the FBI national averages. Try \"what's the safest neighborhood in San Diego?\" or \"how does Chicago compare to Boston?\"",
};

/// Floating AI safety guide. Bottom-right pill on every app tab; click to
/// expand into a chat panel. Uses /api/assistant which streams plain-text
/// responses backed by tool-using Claude — the tools pull from our existing
/// official-data services, so every number the assistant cites is from the
/// same feeds the rest of the app shows.
export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([INTRO]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Persist + restore conversation between page nav.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* ignore */ }
  }, [messages]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Focus input when panel opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    setError(null);
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setBusy(true);

    // Add an empty assistant message that we'll stream into.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Don't replay the intro to the model — it adds noise to the system context.
        body: JSON.stringify({ messages: next.filter((m, i) => !(i === 0 && m === INTRO)) }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("Streaming not supported by this browser.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => m.slice(0, -1)); // remove the empty assistant placeholder
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setMessages([INTRO]);
    setError(null);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      {/* Floating launcher pill, bottom-right. Z-index above the map (Leaflet
          uses 400-1000) but below modals. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close TravelSafe assistant" : "Open TravelSafe assistant"}
        className="fixed bottom-5 right-5 z-[1500] flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate2-900 text-white shadow-card-lift hover:shadow-glow-bay hover:-translate-y-0.5 active:scale-[0.97] transition-all"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-bay-400 animate-pulse" />
        <span className="text-sm font-medium">{open ? "Close" : "Ask TravelSafe"}</span>
      </button>

      {open && (
        // Pin the chat panel to the top-right of the VIEWPORT (not the page),
        // so it sits above the fold no matter how far the user has scrolled.
        // `top-5 right-5` matches the launcher's right offset; `max-h` caps
        // the panel to the viewport height minus a small inset and lets it
        // shrink on short screens. The dialog stays clear of the launcher
        // pill at the bottom-right so both are reachable at once.
        <section
          role="dialog"
          aria-label="TravelSafe assistant"
          className="fixed top-5 right-5 z-[1500] w-[min(24rem,calc(100vw-2.5rem))] max-h-[min(34rem,calc(100vh-2.5rem))] flex flex-col surface bg-white animate-pop-in"
        >
          <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-sand-200">
            <div>
              <h2 className="font-display text-sm text-slate2-900">TravelSafe assistant</h2>
              <p className="text-[10px] uppercase tracking-wider text-slate2-500">Official data only · no personal advice</p>
            </div>
            <button onClick={clear} className="text-[11px] text-slate2-500 hover:text-bay-700 transition-colors">Clear</button>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-bay-500 text-white rounded-br-sm"
                      : "bg-sand-100 text-slate2-900 rounded-bl-sm"
                  }`}
                >
                  {m.content || (busy && i === messages.length - 1 ? <span className="opacity-50">Thinking…</span> : null)}
                </div>
              </div>
            ))}
            {error && (
              <div className="surface-muted p-3 text-xs text-coral-700">
                Could not reach the assistant: {error}
              </div>
            )}
          </div>

          <footer className="border-t border-sand-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about a city or neighborhood…"
                rows={2}
                disabled={busy}
                className="input flex-1 text-sm py-2 resize-none disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="btn-primary text-xs px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "…" : "Send"}
              </button>
            </div>
            <p className="mt-2 text-[10px] text-slate2-500">
              Answers come from the same official police feeds + FBI Crime in the Nation 2024 data the rest of the app uses. No web search, no personal data.
            </p>
          </footer>
        </section>
      )}
    </>
  );
}
