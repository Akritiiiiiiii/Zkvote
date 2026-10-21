import { useEffect, useState } from "react"
import { Ctx, Proposal, connect, loadProposals, createProposal, register, castVote, verify, phase, savedKey, CHAIN_NAME } from "./lib"

type Act = (label: string, f: () => Promise<unknown>) => void
type Tab = "all" | "registration" | "voting" | "closed"
const TABS: [Tab, string][] = [["all", "All ballots"], ["registration", "Sign-up"], ["voting", "Voting"], ["closed", "Closed"]]
const STEPS = [
  ["Register", "Your wallet joins the voter list with a hidden commitment. Nobody sees the secret behind it."],
  ["Prove", "In your browser, a zero-knowledge proof shows you belong to the group without saying which member you are."],
  ["Vote", "The ballot is counted on chain. A nullifier rejects a second ballot without revealing the first."]
]
const fmt = (s: number) => new Date(s * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
const left = (s: number) => {
  const d = Math.max(0, Math.floor(s - Date.now() / 1000)), D = Math.floor(d / 86400), H = Math.floor((d % 86400) / 3600), M = Math.floor((d % 3600) / 60)
  return D ? `${D}d ${H}h` : H ? `${H}h ${M}m` : `${M}m ${String(d % 60).padStart(2, "0")}s`
}
const useTick = () => { const [, set] = useState(0); useEffect(() => { const i = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(i) }, []) }

export default function App() {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [items, setItems] = useState<Proposal[]>([])
  const [busy, setBusy] = useState("")
  const [err, setErr] = useState("")
  const [tab, setTab] = useState<Tab>("all")
  const [loaded, setLoaded] = useState(false)

  const act: Act = async (label, f) => {
    if (!ctx) return
    setErr(""); setBusy(label)
    try { await f(); setItems(await loadProposals(ctx)) } catch (e: any) { setErr(e.reason || e.shortMessage || e.message) }
    setBusy("")
  }
  const join = async () => {
    setErr(""); setBusy("Connecting")
    try { const c = await connect(); setCtx(c); setItems(await loadProposals(c)); setLoaded(true) } catch (e: any) { setErr(e.message) }
    setBusy("")
  }
  const count = (t: Tab) => (t === "all" ? items.length : items.filter((p) => phase(p) === t).length)
  const shown = items.filter((p) => tab === "all" || phase(p) === tab)
  const voters = items.reduce((a, p) => a + p.voters, 0)
  const ballots = items.reduce((a, p) => a + p.tally.reduce((x, y) => x + y, 0), 0)

  return (
    <div className="shell">
      <aside>
        <div>
          <h1>ZK<br />Vote</h1>
          <p className="tag">Private ballots.<br />Public results.</p>
        </div>
        {ctx && <nav aria-label="Filter proposals">
          {TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><span>{l}</span><i>{count(k)}</i></button>)}
        </nav>}
        <div className="foot">
          {ctx ? <p className="acct"><span className="dot" />{ctx.account.slice(0, 6)}…{ctx.account.slice(-4)}<small>{CHAIN_NAME}</small></p>
            : <button className="cta" onClick={join} disabled={!!busy}>Connect MetaMask</button>}
          <p className="fine">Unaudited. Testnet use only.</p>
        </div>
      </aside>
      <main>
        {(busy || err) && <div className={"status" + (err ? " bad" : "")} role="status">{err || busy + "…"}</div>}
        {!ctx ? (
          <section className="intro">
            <p className="kicker">Anonymous on-chain voting</p>
            <h2 className="big">Prove you may vote.<br />Not who you are.</h2>
            <ol className="steps">{STEPS.map(([t, d], i) => <li key={t}><b>{i + 1}</b><div><h3>{t}</h3><p>{d}</p></div></li>)}</ol>
            <p className="fine">Needs MetaMask on {CHAIN_NAME}. Every choice is public and the tally is live; only the link between voter and choice is hidden.</p>
          </section>
        ) : <>
          <div className="ledger">
            <div><b>{items.length}</b><span>proposals</span></div>
            <div><b>{voters}</b><span>registrations</span></div>
            <div><b>{ballots}</b><span>ballots counted</span></div>
          </div>
          <NewProposal act={act} ctx={ctx} />
          {!loaded && <div className="skel" />}
          {loaded && shown.length === 0 && <p className="empty">{items.length ? "Nothing in this view." : "No proposals yet. Publish the first one above."}</p>}
          {shown.map((p) => <Ballot key={p.id} p={p} ctx={ctx} act={act} />)}
        </>}
      </main>
    </div>
  )
}

function Chips({ v, set }: { v: string; set: (m: string) => void }) {
  return <span className="chips">{[["5m", "5"], ["1h", "60"], ["1d", "1440"]].map(([l, m]) =>
    <button type="button" key={m} className={v === m ? "on" : ""} onClick={() => set(m)}>{l}</button>)}</span>
}

function NewProposal({ ctx, act }: { ctx: Ctx; act: Act }) {
  const [f, setF] = useState({ title: "", desc: "", options: "Yes\nNo", reg: "10", vote: "60", allow: "" })
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value })
  const options = f.options.split("\n").map((s) => s.trim()).filter(Boolean)
  const ok = f.title.trim() && options.length >= 2 && options.length <= 8 && +f.reg >= 1 && +f.vote >= 1
  return (
    <details className="new">
      <summary>Write a proposal <span>+</span></summary>
      <label>Title <small>{f.title.length}/120</small><input value={f.title} onChange={set("title")} maxLength={120} placeholder="What are we deciding?" /></label>
      <label>Description<textarea rows={3} value={f.desc} onChange={set("desc")} /></label>
      <label>Options, one per line <small>{options.length} of 2 to 8</small><textarea rows={3} value={f.options} onChange={set("options")} /></label>
      <div className="two">
        <label>Sign-up window, minutes<input type="number" min={1} value={f.reg} onChange={set("reg")} /><Chips v={f.reg} set={(m) => setF({ ...f, reg: m })} /></label>
        <label>Voting window, minutes<input type="number" min={1} value={f.vote} onChange={set("vote")} /><Chips v={f.vote} set={(m) => setF({ ...f, vote: m })} /></label>
      </div>
      <label>Allowed wallets <small>optional, empty means open</small><textarea rows={2} value={f.allow} onChange={set("allow")} placeholder="0x…, 0x…" /></label>
      <button className="solid" disabled={!ok} onClick={() => act("Publishing proposal", () =>
        createProposal(ctx, f.title.trim(), f.desc.trim(), options, +f.reg * 60, +f.vote * 60, f.allow.split(/[\s,]+/).filter(Boolean)))}>Publish proposal</button>
    </details>
  )
}

function Ballot({ p, ctx, act }: { p: Proposal; ctx: Ctx; act: Act }) {
  useTick()
  const ph = phase(p)
  const [choice, setChoice] = useState<number | null>(null)
  const [key, setKey] = useState("")
  const [check, setCheck] = useState("")
  const [copied, setCopied] = useState(false)
  const saved = savedKey(ctx, p.id)
  const total = p.tally.reduce((a, b) => a + b, 0)
  const lead = Math.max(...p.tally)
  const stub = ph === "registration" ? "Open for sign-up" : ph === "voting" ? "Voting" : "Closed"
  const clock = ph === "registration" ? `Voting opens in ${left(p.registrationEnd)}` : ph === "voting" ? `Closes in ${left(p.votingEnd)}` : "Ended " + fmt(p.votingEnd)
  const turnout = p.voters ? Math.round((total / p.voters) * 100) : 0
  const idx = ph === "registration" ? 0 : ph === "voting" ? 1 : 2

  return (
    <article className="card">
      <div className={"stub " + ph}>
        <b>{stub}</b>
        <span className="clock">{clock}</span>
        <ol className="track" aria-hidden>{["Sign-up", "Voting", "Result"].map((l, i) => <li key={l} className={i < idx ? "done" : i === idx ? "now" : ""}>{l}</li>)}</ol>
      </div>
      <div className="body">
        <p className="num">No. {String(p.id + 1).padStart(3, "0")}</p>
        <h2>{p.title}</h2>
        {p.description && <p className="desc">{p.description}</p>}
        <ul className="opts">
          {p.options.map((o, i) => (
            <li key={i} className={(choice === i ? "on " : "") + (ph === "closed" && total > 0 && p.tally[i] === lead ? "win " : "") + (ph === "voting" ? "pick" : "")}
                onClick={() => ph === "voting" && setChoice(i)}>
              <span className="bar" style={{ width: total ? (p.tally[i] / total) * 100 + "%" : 0 }} />
              <span className="oval" /><span className="lab">{o}</span>
              <span className="pct">{total ? Math.round((p.tally[i] / total) * 100) + "%" : ""}</span><span className="n">{p.tally[i]}</span>
            </li>
          ))}
        </ul>
        <p className="meta"><span>{p.voters} registered</span><span>{total} {total === 1 ? "ballot" : "ballots"}{p.voters ? ` · ${turnout}% turnout` : ""}</span>{p.restricted && <span>allowlist only</span>}</p>

        {ph === "registration" && !p.joined && <button className="solid" onClick={() => act("Registering", () => register(ctx, p))}>Register to vote</button>}
        {p.joined && saved && (
          <p className="note key">Registered. Your voting key is saved in this browser.{" "}
            <button className="ghost" onClick={() => navigator.clipboard.writeText(saved).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}>{copied ? "Copied" : "Copy voting key"}</button>
            {" "}Whoever holds it can cast your ballot.</p>
        )}
        {ph === "voting" && (
          <div className="act">
            <p className="step"><b>1</b>Pick an option above.</p>
            <p className="step"><b>2</b>Use another funded wallet for unlinkability, then paste your key.</p>
            <textarea rows={2} value={key} onChange={(e) => setKey(e.target.value)} placeholder={saved ? "Leave empty to use this wallet's saved key" : "Paste your voting key"} />
            <p className="step"><b>3</b>Generate the proof and cast.</p>
            <button className="solid" disabled={choice === null || (!key.trim() && !saved)}
              onClick={() => act("Generating proof and casting ballot", async () => { await castVote(ctx, p, choice!, key); setKey("") })}>Cast ballot</button>
          </div>
        )}
        {total > 0 && (
          <p className="meta">
            <button className="ghost" onClick={async () => { setCheck("Counting…"); try { const r = await verify(ctx, p); setCheck(`Recounted ${r.ballots} ballots from chain events. ${r.ok ? "Matches the stored tally." : "Does not match the stored tally."}`) } catch (e: any) { setCheck("Recount failed: " + (e.shortMessage || e.message)) } }}>Recount from chain events</button>
            <span>{check}</span>
          </p>
        )}
      </div>
    </article>
  )
}
