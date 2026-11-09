import { useEffect, useState, type ReactNode } from 'react';
import { activationSnapshot, bch, offerStatus, ranked, score, short, staleReason, tokenUnits, utc, type Envelope, type Offer, type Vault } from './model';
import { useArena } from './useArena';
import './style.css';

type Page = 'overview' | 'offers' | 'periods' | 'positions';
const pages: { id: Page; label: string; icon: string }[] = [{id:'overview',label:'Overview',icon:'grid'},{id:'offers',label:'Offer marketplace',icon:'offers'},{id:'periods',label:'Period history',icon:'clock'},{id:'positions',label:'Staker positions',icon:'layers'}];
function Icon({name, size=20}: {name:string;size?:number}) {
  const paths: Record<string, ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    offers:<><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="17" r="2"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    layers:<><path d="m3 7 9-5 9 5-9 5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
    arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>, refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    check:<path d="m5 12 4 4L19 6"/>, shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    coin:<><circle cx="12" cy="12" r="9"/><path d="M9 7v10m0-9h5a2 2 0 0 1 0 4H9m0 0h6a2 2 0 0 1 0 4H9m2-10v2m2-2v2m-2 8v2m2-2v2"/></>,
    lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.grid}</svg>;
}
function Badge({children, tone='muted'}:{children:ReactNode;tone?:'green'|'amber'|'muted'}) { return <span className={`badge ${tone}`}>{children}</span>; }
function Hash({value}:{value:string}) { return <code className="hash" title={value}>{short(value)}</code>; }
function Empty({title,children}:{title:string;children:ReactNode}) { return <div className="empty"><span className="empty-icon"><Icon name="layers" size={26}/></span><h3>{title}</h3><p>{children}</p></div>; }
function Money({sats}:{sats:string|number|bigint}) { return <span className="money">{bch(sats)} <span className="unit">BCH</span></span>; }
function TokenNote({vault}:{vault:Vault}) { return <span>Staking token <Hash value={vault.config.stakingCategory}/> <span className="subtle">· raw units; decimals and symbol not supplied</span></span>; }
function phase(v:Vault) { return v.period>=v.config.periods ? 'Schedule complete' : v.phase==='activated' ? 'Snapshot activated' : v.readyPeriods.includes(v.period) ? 'Ready for activation' : 'Awaiting boundary'; }
function currentEligibility(v:Vault,o:Offer) {
  if (v.phase==='activated' && v.rankings.some(r=>r.slot===o.slot)) return 'Eligible in snapshot';
  if (v.period>=v.config.periods) return 'Schedule complete';
  return offerStatus(o);
}
function Schedule({vault}:{vault:Vault}) {
  return <div className="schedule" aria-label="Confirmed period progression">{vault.periods.map(p=><div key={p.period} className={`schedule-step ${p.status}`}><span className="step-dot">{p.status==='settled'?<Icon name="check" size={14}/>:p.period}</span><strong>Period {p.period}</strong><span>{p.status==='settled'?(p.events.some(e=>e.action===5)?'Empty · advanced':'Settled'):p.status==='activated'?'Activated':'Scheduled'}</span></div>)}</div>;
}
function Overview({data,selected,onSelect,onPage}:{data:Envelope;selected:Vault;onSelect:(id:string)=>void;onPage:(page:Page)=>void}) {
  const total = data.vaults.reduce((sum,v)=>sum+BigInt(v.bchSatoshis),0n);
  const settled = data.vaults.reduce((sum,v)=>sum+v.period,0), periods = data.vaults.reduce((sum,v)=>sum+v.config.periods,0);
  const allocations = data.vaults.flatMap(v=>v.allocations).filter(a=>!a.withdrawal).length;
  const winner = selected.rankings[0];
  return <>
    <div className="stats">
      <article className="stat"><div className="stat-label">Admitted vaults <Icon name="grid"/></div><strong>{data.vaults.length.toString().padStart(2,'0')}</strong><span>Canonical genesis verified by indexer</span></article>
      <article className="stat"><div className="stat-label">Native BCH reserves <Icon name="coin"/></div><strong className="stat-money">{bch(total)}<small>BCH</small></strong><span>{tokenUnits(total)} satoshis · all admitted vaults</span></article>
      <article className="stat"><div className="stat-label">Settled periods <Icon name="clock"/></div><strong>{settled}<small>/ {periods}</small></strong><span>Includes confirmed empty-period advances</span></article>
      <article className="stat"><div className="stat-label">Independent allocations <Icon name="layers"/></div><strong>{allocations.toString().padStart(2,'0')}</strong><span>Unspent allocations across admitted vaults</span></article>
    </div>
    <div className="section-heading"><div><span className="eyebrow">ON THE CONFIRMED CHAIN</span><h2>Explore the vaults</h2></div><span className="subtle">{data.vaults.length} admitted {data.vaults.length===1?'vault':'vaults'}</span></div>
    <div className="vault-grid">{data.vaults.map(v=><button key={v.category} className={`vault-card ${v.category===selected.category?'selected':''}`} onClick={()=>onSelect(v.category)} aria-pressed={v.category===selected.category}>
      <div className="card-top"><span className="vault-icon"><Icon name="shield" size={24}/></span><Badge tone={v.phase==='activated'?'green':'muted'}>{phase(v)}</Badge></div>
      <h3>Vault <Hash value={v.category}/></h3><p className="subtle">Staking category <Hash value={v.config.stakingCategory}/></p>
      <div className="vault-balance"><Money sats={v.bchSatoshis}/><span>Vault BCH reserve</span></div>
      <div className="vault-details"><div><span>Offers</span><strong>{v.offers.length} <small>/ 16 lifetime</small></strong></div><div><span>{v.period>=v.config.periods?'Period progress':'Current period'}</span><strong>{v.period>=v.config.periods?v.period:`Period ${v.period}`} <small>{v.period>=v.config.periods?`/ ${v.config.periods} settled`:`· ${v.period}/${v.config.periods} settled`}</small></strong></div></div>
      <div className="progress-track"><span style={{width:`${v.period/v.config.periods*100}%`}}/></div>
      <div className="vault-bottom"><span>{v.category===selected.category?'Selected vault':'Inspect vault'}</span><Icon name={v.category===selected.category?'check':'arrow'} size={17}/></div>
    </button>)}</div>
    <div className="overview-grid">
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">SELECTED VAULT</span><h2>The period path</h2></div><Badge tone={selected.phase==='activated'?'green':'muted'}>{phase(selected)}</Badge></div>
        <Schedule vault={selected}/><div className="schedule-explainer"><Icon name="info"/><p>UTC boundaries set the schedule. Activation freezes the eligible roster on-chain; settlement follows as a separate confirmed transaction. BCH reserves include the covenant carrier and remaining fee reserve.</p></div>
        <dl className="details-grid"><div><dt>Schedule begins</dt><dd>{utc(selected.config.epoch)}</dd></div><div><dt>Period length</dt><dd>{tokenUnits(selected.config.periodSeconds)} seconds</dd></div><div><dt>Remaining token escrow</dt><dd>{tokenUnits(selected.escrowTokens)} raw units</dd></div><div><dt>Reward cap per period</dt><dd><Money sats={selected.config.cap}/></dd></div></dl>
        <button className="text-button" onClick={()=>onPage('periods')}>Inspect snapshots & history <Icon name="arrow" size={16}/></button>
      </section>
      <section className="panel leader-panel"><div className="panel-heading"><div><span className="eyebrow">{selected.phase==='activated'?'FROZEN ROSTER':'LIVE ROSTER'}</span><h2>{selected.period>=selected.config.periods?'Final roster ranking':selected.phase==='activated'?'Snapshot leader':'Leading offer'}</h2></div><Icon name="offers"/></div>
        {winner?<><span className="offer-number">OFFER #{winner.slot.toString().padStart(2,'0')}</span><div className="leader-score">{score(winner)}<small>priority score P</small></div><p className="subtle">{selected.phase==='activated'?'Ranked against the full activated snapshot.':'Provisional roster ranking; eligibility freezes at activation.'}</p><div className="leader-details"><span>{tokenUnits(winner.stake)} token units × {winner.duration} periods</span><strong><Money sats={winner.reward}/> requested</strong></div></>:<div className="compact-empty"><Icon name="offers" size={30}/><p>No eligible offer remains in this roster.</p></div>}
        <button className="text-button" onClick={()=>onPage('offers')}>Explore the marketplace <Icon name="arrow" size={16}/></button>
      </section>
    </div>
  </>;
}
function Offers({vault}:{vault:Vault}) {
  const [eligibleOnly,setEligibleOnly] = useState(false);
  const eligible = (o:Offer)=>currentEligibility(vault,o).startsWith('Eligible');
  const offers = vault.offers.filter(o=>!eligibleOnly||eligible(o));
  const ranks = new Map(vault.rankings.map((o,i)=>[o.slot,i+1]));
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPLETE AUTHENTICATED ROSTER</span><h2>Every offer. One canonical order.</h2></div><label className="checkbox"><input type="checkbox" checked={eligibleOnly} onChange={e=>setEligibleOnly(e.target.checked)}/> Eligible only</label></div>
    <div className="info-strip"><Icon name="info"/><p><strong>P = S × T / R.</strong> S is raw staking-token units, T is periods, R is native BCH reward in satoshis. Higher scores rank first. Exact ties go to the lower canonical registration slot; displayed scores truncate at six decimals.</p></div>
    <div className="table-caption"><TokenNote vault={vault}/><Badge tone={vault.phase==='activated'?'green':'muted'}>{vault.phase==='activated'?'Frozen snapshot ranking':'Provisional live-roster ranking'}</Badge></div>
    {offers.length?<div className="table-scroll"><table><thead><tr><th>Offer / owner</th><th>Roster rank</th><th>Stake S</th><th>Duration T</th><th>Requested R</th><th>Score P</th><th>Wins</th><th>Eligibility</th></tr></thead><tbody>{offers.map(o=><tr key={o.slot}><td><strong>Offer #{o.slot.toString().padStart(2,'0')}</strong><Hash value={o.owner}/></td><td>{ranks.has(o.slot)?<span className={ranks.get(o.slot)===1?'rank first':'rank'}>#{ranks.get(o.slot)}</span>:'—'}</td><td className="numeric">{tokenUnits(o.stake)}<small>raw units</small></td><td>{o.duration}<small>periods</small></td><td className="numeric"><Money sats={o.reward}/><small>{tokenUnits(o.reward)} sats</small></td><td className="numeric score">{score(o)}</td><td>{o.wins} / {o.maxWins}</td><td><Badge tone={eligible(o)?'green':'muted'}>{currentEligibility(vault,o)}</Badge>{vault.phase==='activated'&&o.cancelled&&eligible(o)&&<small>Cancelled for future periods</small>}{vault.period>=vault.config.periods&&offerStatus(o)!=='Eligible'&&<small>{offerStatus(o)}</small>}</td></tr>)}</tbody></table></div>:<Empty title={eligibleOnly?'No eligible offers':'The roster is open space'}>{eligibleOnly?'No offer matches the eligibility filter. Clear it to inspect the complete roster.':'This vault has no confirmed registrations. New offers will appear after confirmation and indexing.'}</Empty>}
    <div className="panel-footnote">Registration slots start at 0 and never change. Live win counts and cancellations may differ from the immutable activated snapshot.</div>
  </section>;
}
function SnapshotTable({offers}:{offers:Offer[]}) {
  const order = new Map(ranked(offers).map((o,i)=>[o.slot,i+1]));
  return offers.length?<div className="table-scroll"><table><thead><tr><th>Snapshot offer</th><th>Rank</th><th>Committed stake</th><th>Duration</th><th>Requested BCH</th><th>Snapshot eligibility</th></tr></thead><tbody>{offers.map(o=><tr key={o.slot}><td><strong>Offer #{o.slot.toString().padStart(2,'0')}</strong><Hash value={o.owner}/></td><td>{order.get(o.slot)?`#${order.get(o.slot)}`:'—'}</td><td>{tokenUnits(o.stake)} raw units</td><td>{o.duration} periods</td><td><Money sats={o.reward}/></td><td>{offerStatus(o)}</td></tr>)}</tbody></table></div>:<p className="subtle">The activated snapshot contains no registrations.</p>;
}
function Periods({vault}:{vault:Vault}) {
  return <><div className="info-strip stand-alone"><Icon name="clock"/><p>All schedule and maturity dates are UTC. Actual activation and settlement are identified by confirmed block height and transaction ID. <strong>The v0.3.0 API does not supply event block timestamps.</strong> A scheduled boundary is never shown as an execution time.</p></div>
    <section className="period-list">{vault.periods.map(p=>{
      const activation = p.events.find(e=>e.action===2), settlement = p.events.find(e=>e.action===3||e.action===5);
      const snapshot = activation ? activationSnapshot(activation) : null;
      const winning = settlement?.action===3 ? snapshot?.find(o=>o.slot===settlement.slot) : undefined;
      return <article className="panel period-card" key={p.period}><div className="period-summary"><span className={`period-symbol ${p.status}`}><Icon name={p.status==='settled'?'check':'clock'} size={22}/></span><div><span className="eyebrow">PERIOD {p.period}</span><h2>{settlement?.action===5?'Empty period advanced':settlement?'Reward settled':activation?'Snapshot activated':'Awaiting activation'}</h2></div><Badge tone={p.status==='settled'?'green':p.status==='activated'?'amber':'muted'}>{p.status==='unsettled'?'Scheduled':p.status}</Badge></div>
        <dl className="period-times"><div><dt>Scheduled UTC boundary</dt><dd>{utc(p.boundary)}</dd></div><div><dt>Actual on-chain activation</dt><dd>{activation?<>Block {tokenUnits(activation.height)}<Hash value={activation.txid}/></>:'Not confirmed'}</dd></div><div><dt>Actual on-chain settlement</dt><dd>{settlement?<>Block {tokenUnits(settlement.height)}<Hash value={settlement.txid}/></>:'Not confirmed'}</dd></div><div><dt>Winning offer / requested reward</dt><dd>{winning?<>Offer #{winning.slot.toString().padStart(2,'0')}<span><Money sats={winning.reward}/></span></>:settlement?.action===5?'No eligible winner':'—'}</dd></div></dl>
        {activation&&<details className="snapshot-details"><summary>Inspect activated snapshot <span>{snapshot!.length} registrations · full immutable roster</span></summary><SnapshotTable offers={snapshot!}/></details>}
      </article>;
    })}</section></>;
}
function Positions({vault,isStale}:{vault:Vault;isStale:boolean}) {
  const [query,setQuery] = useState('');
  const positions = vault.allocations.filter(a=>`${a.owner} ${a.id}`.toLowerCase().includes(query.toLowerCase().trim()));
  const outstanding = vault.allocations.filter(a=>!a.withdrawal), locked=outstanding.filter(a=>!a.eligible).reduce((s,a)=>s+BigInt(a.stake),0n);
  return <><div className="position-summary"><div><span className="eyebrow">INDEPENDENT STAKE LOCKS</span><h2>{tokenUnits(locked)} <small>raw units locked at indexed MTP</small></h2><TokenNote vault={vault}/></div><div className="position-count"><strong>{outstanding.length}</strong><span>unspent allocations</span></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Your view of staker positions</h2><p className="subtle">Public positions in the selected vault. No wallet connection is needed.</p></div><label className="search"><Icon name="search" size={17}/><input aria-label="Filter positions by public owner key or allocation ID" placeholder="Filter owner or allocation ID" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
      {positions.length?<div className="allocation-grid">{positions.map(a=><article className="allocation-card" key={a.id}><div className="card-top"><span className="allocation-icon"><Icon name={a.withdrawal?'check':a.eligible?'shield':'lock'}/></span><Badge tone={a.withdrawal?'muted':isStale?'amber':a.eligible?'green':'amber'}>{a.withdrawal?'Withdrawn':isStale?'Recheck synchronization':a.eligible?'Eligible at indexed MTP':'Locked at indexed MTP'}</Badge></div><h3>{tokenUnits(a.stake)} <small>raw token units</small></h3><p className="subtle">Independent allocation · winning period {a.period}</p><dl><div><dt>Offer</dt><dd>#{a.slot.toString().padStart(2,'0')}</dd></div><div><dt>Owner public key</dt><dd><Hash value={a.owner}/></dd></div><div><dt>Fixed UTC maturity</dt><dd>{utc(a.maturity)}</dd></div><div><dt>Allocation outpoint</dt><dd><Hash value={a.id}/></dd></div>{a.withdrawal&&<div><dt>Withdrawal transaction</dt><dd><Hash value={a.withdrawal}/></dd></div>}</dl><div className="allocation-note"><Icon name="info" size={15}/>{a.withdrawal?'Withdrawal is confirmed on-chain.':'Maturity uses chain MTP, not your browser clock. Owner signature required; withdrawals are not available in this viewer.'}</div></article>)}</div>:<Empty title={query?'No matching positions':'No independent allocations yet'}>{query?'Try another owner public key or allocation ID.':'Each confirmed winning settlement creates its own token allocation. It will appear here with its fixed UTC maturity.'}</Empty>}
    </section>
    {!!vault.withdrawals.commitments.length&&<div className="info-strip stand-alone"><Icon name="info"/><p>Unused offer commitments remain separate from per-win allocations. The indexer reports {vault.withdrawals.commitments.filter(c=>c.eligible).length} commitment refunds eligible at the indexed state. This viewer cannot submit refunds or withdrawals.</p></div>}
  </>;
}
export default function App() {
  const live = useArena();
  const [page,setPage] = useState<Page>(()=>pages.find(p=>p.id===window.location.hash.slice(1))?.id??'overview');
  const [selectedId,setSelectedId] = useState('');
  const selected = live.data?.vaults.find(v=>v.category===selectedId) ?? live.data?.vaults[0];
  useEffect(()=>{ const navigate=()=>setPage(pages.find(p=>p.id===window.location.hash.slice(1))?.id??'overview');window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate); },[]);
  function navigate(next:Page) { window.location.hash=next; setPage(next); window.scrollTo({top:0,behavior:'instant'}); }
  const stale = staleReason(live.data,live.now,live.error);
  const names: Record<Page,{title:string;subtitle:string}> = {
    overview:{title:'The arena, at a glance.',subtitle:'Follow the vaults. Understand the offers. See what the chain confirms.'},
    offers:{title:'Where commitment ranks.',subtitle:'The complete offer roster, with transparent terms and canonical ordering.'},
    periods:{title:'Every period has a record.',subtitle:'Scheduled boundaries, frozen snapshots and confirmed settlements.'},
    positions:{title:'A clear view of every lock.',subtitle:'Independent stake allocations, fixed maturities and indexed eligibility.'},
  };
  return <div className="app"><a className="skip-link" href="#main" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a>
    <aside className="sidebar"><a href="#overview" className="brand" onClick={()=>setPage('overview')}><img src="./arena.svg" width="42" height="42" alt=""/><span>staking<span>arena<span className="brand-dot">.</span></span></span></a><div className="workspace-label">THE OBSERVATION DECK</div><nav aria-label="Main navigation">{pages.map(p=><a key={p.id} href={`#${p.id}`} aria-current={page===p.id?'page':undefined} className={page===p.id?'active':''} onClick={()=>setPage(p.id)}><Icon name={p.icon}/><span>{p.label}</span>{page===p.id&&<span className="nav-indicator"/>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="read-only-card"><Icon name="shield"/><strong>Observe with confidence</strong><p>Live chain data. Read-only access. Your keys stay yours.</p><span>VIEWER MODE <Icon name="lock" size={12}/></span></div><div className="sidebar-version"><span>Staking Arena</span><span>v0.3.0</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>{pages.find(p=>p.id===page)!.label}</strong></div><div className="topbar-status"><span className="network"><span className="dot"/> BCH REGTEST</span><span className="topbar-divider"/><span className="read-only-label"><Icon name="lock" size={14}/> Read-only</span></div></header>
      <main id="main" tabIndex={-1}><div className="page-heading"><div><span className="eyebrow">STAKING ARENA EXPLORER</span><h1>{names[page].title}</h1><p>{names[page].subtitle}</p></div><button className="refresh-button" onClick={live.refresh} disabled={live.pending}><Icon name="refresh" size={17}/>{live.pending?'Refreshing…':'Refresh data'}</button></div>
        <div className="chain-bar"><div><span className={`dot ${stale||!live.data?'warning':''}`}/><strong>{!live.data?'Connecting to indexer':stale?'Check synchronization':'Indexer synchronized'}</strong></div><span>Chain tip <strong className="numeric">{live.data?.tip?`#${tokenUnits(live.data.tip.height)}`:'—'}</strong>{live.data?.tip&&<Hash value={live.data.tip.hash}/>}</span><span><Icon name="shield" size={14}/> {live.data?.confirmedOnly?'Confirmed only':'Awaiting confirmation metadata'}</span><span className="last-refresh">{live.receivedAt?`Fetched ${Math.max(0,Math.floor((live.now-live.receivedAt)/1000))}s ago`:'Refreshes every 10s'}</span></div>
        {stale&&<div className="warning-banner" role="alert"><Icon name="info"/><div><strong>Live state needs a fresh check</strong><p>{stale}</p>{live.error&&<p>{live.error}</p>}{live.data?.health.error&&<p>Indexer: {live.data.health.error}</p>}</div></div>}
        {!live.data&&live.pending?<div className="loading" role="status"><div className="skeleton-heading"/><div className="skeleton-grid">{[0,1,2,3].map(n=><div className="skeleton-card" key={n}/>)}</div><p>Reading the confirmed vault state…</p></div>:!live.data?<section className="panel"><Empty title="The indexer is out of reach"><span>{live.error??'Could not read the API.'} Start the local API on port 3100 and try again. This page retries automatically every 10 seconds.</span></Empty><div className="center"><button className="refresh-button" onClick={live.refresh}>Try again <Icon name="refresh" size={16}/></button></div></section>:!selected?<section className="panel"><Empty title={live.data.health.connected?'No admitted vaults yet':'Waiting for the first synchronized state'}>{live.data.health.connected?'The indexer has not admitted an active vault. Configure a canonical genesis in the indexer; confirmed vaults appear here automatically.':'The indexer has not published a confirmed vault projection. Check its synchronization health and local configuration.'}</Empty></section>:<>
          <div className="vault-selector"><label htmlFor="selected-vault">Inspecting vault</label><select id="selected-vault" value={selected.category} onChange={e=>setSelectedId(e.target.value)}>{live.data.vaults.map(v=><option key={v.category} value={v.category}>{short(v.category,10)}</option>)}</select><span className="selector-category">Token category <Hash value={selected.config.stakingCategory}/></span></div>
          {page==='overview'?<Overview data={live.data} selected={selected} onSelect={setSelectedId} onPage={navigate}/>:page==='offers'?<Offers key={selected.category} vault={selected}/>:page==='periods'?<Periods vault={selected}/>:<Positions key={selected.category} vault={selected} isStale={!!stale}/>}
        </>}
        <footer className="footer"><span><span className="footer-mark">◈</span> Transparent by design. Confirmed by the chain.</span><span>Native BCH rewards <span>·</span> CashToken stakes <span>·</span> Regtest only</span></footer>
        {live.data?.tip&&<div className="sync-detail">Indexed chain MTP: {utc(live.data.tip.mtp)} · Indexer last synchronized: {live.data.health.updatedAt||'not yet'} · Eligibility is evaluated at this indexed state.</div>}
      </main>
    </div>
  </div>;
}
