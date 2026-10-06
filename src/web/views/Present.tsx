import { useEffect, useState } from "preact/hooks";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, joinUrl, plural, useTitle } from "../lib/util";
import { Brand, ConnProblem, ResultsView, TYPE_LABEL, UpIcon } from "../components/ui";

function QrCode({ url }: { url: string }) {
  const [svg, setSvg] = useState("");
  // Loaded only on the big screen, so attendees' phones don't download it.
  useEffect(() => {
    import("qrcode-generator").then(({ default: qrcode }) => {
      const qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      setSvg(qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }));
    }).catch(() => setSvg(""));
  }, [url]);
  return svg ? <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for ${url}`} role="img" /> : null;
}

export function Present({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const { state, status } = useRoom(code, "present", key || undefined);
  const s = state.snapshot;
  useTitle(s ? `${s.meta.title} · ${CFG.name}` : CFG.name);
  if (status === "not-found") return <ConnProblem status={status} code={code} />;

  const poll = s ? activePoll(s) : undefined;
  const mode = s ? (s.meta.presentMode === "auto" ? (poll ? "poll" : "qa") : s.meta.presentMode) : "code";

  let stage = null;
  if (s && mode === "poll") {
    stage = poll ? (
      <>
        <div class="kicker">
          {TYPE_LABEL[poll.type]} · {poll.status === "active" ? "Live poll" : "Closed"}
        </div>
        <h1 style={{ margin: "10px 0 28px" }}>{poll.title}</h1>
        <ResultsView poll={poll} results={resultsOf(s, poll.id)} big />
      </>
    ) : (
      <div class="feature" style={{ marginTop: "20vh" }}>
        No poll running yet.
      </div>
    );
  } else if (s && mode === "qa") {
    const qs = sortQuestions(
      s.questions.filter((q) => q.status === "live"),
      "popular",
    );
    const hl = qs.find((q) => q.highlighted);
    const rest = qs.filter((q) => !q.highlighted).slice(0, hl ? 4 : 7);
    stage = (
      <>
        <div class="kicker">{s.meta.title}</div>
        {hl ? (
          <div class="q hl" style={{ marginTop: 16 }}>
            <div class="body">
              <span class="tag hl">Now answering</span>
              <div class="feature" style={{ fontSize: "clamp(28px,3vw,48px)", marginTop: 10 }}>
                {hl.text}
              </div>
              <div class="meta" style={{ fontSize: 18 }}>
                {hl.name || "Anonymous"} · {plural(hl.votes, "vote")}
              </div>
            </div>
          </div>
        ) : (
          <h1 style={{ margin: "10px 0 18px" }}>Questions</h1>
        )}
        <div style={{ marginTop: 16 }}>
          {rest.map((q) => (
            <div class="q" key={q.id}>
              <div class="vote" style={{ cursor: "default" }}>
                <UpIcon />
                <span>{q.votes}</span>
              </div>
              <div class="body">
                <div class="text">{q.text}</div>
                <div class="meta">{q.name || "Anonymous"}</div>
              </div>
            </div>
          ))}
          {!rest.length && !hl && (
            <div class="feature" style={{ marginTop: "14vh", color: "var(--muted)" }}>
              Ask your question at {location.host} — code {code}
            </div>
          )}
        </div>
      </>
    );
  } else {
    stage = (
      <>
        <div class="kicker">{s?.meta.title}</div>
        <div class="feature" style={{ marginTop: "20vh" }}>
          Join the conversation at <b>{location.host}</b>
          <br />
          with code <b style={{ color: "var(--link)" }}>{code}</b>
        </div>
      </>
    );
  }

  return (
    <div class="present">
      <aside>
        <Brand />
        <div>
          <div class="small" style={{ opacity: 0.75 }}>
            Join at
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{location.host}</div>
        </div>
        <div>
          <div class="small" style={{ opacity: 0.75 }}>
            Event code
          </div>
          <div class="big-code">{code}</div>
        </div>
        <QrCode url={joinUrl(code)} />
        <div class="small" style={{ opacity: 0.75, marginTop: "auto" }}>
          {s?.online ?? 0} {(s?.online ?? 0) === 1 ? "person" : "people"} connected
        </div>
      </aside>
      <main>{stage}</main>
    </div>
  );
}
