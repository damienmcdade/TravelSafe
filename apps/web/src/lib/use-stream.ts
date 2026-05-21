"use client";
import { useCallback, useRef, useState } from "react";
import { API_BASE } from "./api-client";

/// Streams a text/plain response chunk-by-chunk from the API. Used by the
/// AI-assisted composer to render coaching as it generates.
export function useTextStream(path: string) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error" | "disabled">("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (body: unknown) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setText("");
    setError(null);
    setStatus("streaming");
    try {
      const res = await fetch(`${API_BASE}/api${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (res.status === 503) {
        setStatus("disabled");
        return;
      }
      if (!res.ok || !res.body) {
        setStatus("error");
        setError(`http_${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
      setStatus("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setError((e as Error).message);
    }
  }, [path]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setText("");
    setStatus("idle");
    setError(null);
  }, []);

  return { text, status, error, start, reset };
}
