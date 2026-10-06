import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { CLOSE, PING, type ClientMsg, type Reaction, type Role, type ServerMsg } from "../../shared/protocol";
import { emptyRoom, reduce, type RoomState } from "../../shared/store";
import { pid, toast } from "./util";

export type ConnStatus = "connecting" | "online" | "offline" | "not-found" | "full" | "forbidden" | "passcode";

interface Options {
  key?: string;
  passcode?: string;
  onReactions?: (counts: Partial<Record<Reaction, number>>) => void;
}

/** Connects to an event, keeps a live copy of it, and reconnects automatically. */
export function useRoom(code: string, role: Role, opts: Options = {}) {
  const [state, dispatch] = useReducer<RoomState, ServerMsg>(reduce, emptyRoom());
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onReactions = useRef(opts.onReactions);
  onReactions.current = opts.onReactions;
  const { key, passcode } = opts;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval>;
    let timer: ReturnType<typeof setTimeout>;

    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = new URLSearchParams({ role, pid, ...(key ? { key } : {}), ...(passcode ? { pass: passcode } : {}) });
      const ws = new WebSocket(`${proto}://${location.host}/api/events/${code}/ws?${qs}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("online");
        clearInterval(ping);
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING), 25_000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        if (msg.type === "error") toast(msg.message);
        else if (msg.type === "reactions") onReactions.current?.(msg.counts);
        else dispatch(msg);
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        if (closed) return;
        if (e.code === CLOSE.NOT_FOUND) return setStatus("not-found");
        if (e.code === CLOSE.FULL) return setStatus("full");
        if (e.code === CLOSE.FORBIDDEN) return setStatus("forbidden");
        if (e.code === CLOSE.PASSCODE) return setStatus("passcode");
        setStatus("offline");
        timer = setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    open();
    // Reconnect right away when the phone wakes up or the tab comes back.
    const wake = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState === WebSocket.CLOSED && !closed) {
        clearTimeout(timer);
        open();
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      wsRef.current?.close();
    };
  }, [code, role, key, passcode]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else toast("Reconnecting… try again in a second");
  }, []);

  return { state, status, send };
}

export type Send = ReturnType<typeof useRoom>["send"];
