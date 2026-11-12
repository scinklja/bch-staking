import {vaultShareLink} from './vaultCatalog';
import {BrowserCreateForm,BrowserOfferForm,VaultImport} from './BrowserWalletForms';
import SettlementStatus from './SettlementStatus';
import TransactionStatus from './TransactionStatus';
import { WalletTransactionsContext, useWalletTransactions, transactionApi, type WalletTransactions } from './walletTransactions';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { bch, offerStatus, score, short, staleReason, tokenUnits, utc, type Envelope, type Offer, type Vault } from './model';
import { competingOffers, integer, offerPreview, periodLength, rewardSatoshis, routeFromHash, vaultHref, vaultStatus } from './marketplace';
import { useArena } from './useArena';
import WalletConnect from './WalletConnect';
import { CHIPNET_NETWORK, requiredNetworkForVault } from './walletNetwork';
import './style.css';

const GeneralizedAssets=lazy(()=>import('./GeneralizedAssets'));

function Asset({category}:{category:string}) { return <span className="asset">CashToken <code title={category}>{short(category)}</code><small>Raw token units · decimals not supplied</small></span>; }
function Term({label,children}:{label:string;children:ReactNode}) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function PreviewNote() { const wallet=useWalletTransactions(); return <div className="preview-note"><strong>Chipnet test funds only</strong><p>{wallet?'Review and approve each funding or covenant operation in your chipnet wallet. Broadcasts appear after confirmation.':'Create Vault and Make an Offer are unavailable until wallet-authorized transactions are implemented for browser mode. These forms are previews only.'}</p></div>; }
function State({title,children}:{title:string;children:ReactNode}) {return <section className="empty"><h2>{title}</h2><p>{children}</p></section>;}
function VaultList({data,stale}:{data:Envelope;stale:boolean}) {
  return <ul className="vault-list">{data.vaults.map(v=><li key={v.category}><a className="vault-row" href={vaultHref(v.category)}>
    <div className="vault-name"><span className="vault-symbol" aria-hidden="true">◇</span><strong>Vault {short(v.category)}</strong><span className={`badge ${vaultStatus(v,data.tip).toLowerCase().split(' ')[0]}`}>{vaultStatus(v,data.tip)}{stale?' · at snapshot':''}</span></div>
    <dl><Term label="Maximum reward / period"><strong>{bch(v.config.cap)} BCH</strong></Term><Term label="Reward asset">Native BCH</Term><Term label="Total periods">{v.config.periods}</Term><Term label="Period duration">{periodLength(v.config.periodSeconds)}</Term></dl><span className="row-arrow" aria-hidden="true">↗</span>
  </a></li>)}</ul>;
}
function OfferTable({offers,inactive=false}:{offers:Offer[];inactive?:boolean}) {
  return <div className="table-scroll"><table><caption className="sr-only">{inactive?'Inactive registrations':'Competing offers ranked by priority'}</caption><thead><tr><th>{inactive?'Registration':'Rank'}</th><th>Offer</th><th>Stake S</th><th>Lock T</th><th>Reward R</th><th>Max wins W</th><th>{inactive?'Status':'Priority P'}</th></tr></thead><tbody>{offers.map((o,i)=><tr key={o.slot}><td>{inactive?'—':i+1}</td><th scope="row">Offer #{o.slot.toString().padStart(2,'0')}</th><td>{tokenUnits(o.stake)}<small>raw units</small></td><td>{o.duration}<small>periods per win</small></td><td>{bch(o.reward)}<small>BCH / winning period</small></td><td>{o.maxWins}<small>{o.wins} won</small></td><td><strong>{inactive?offerStatus(o):score(o)}</strong></td></tr>)}</tbody></table></div>;
}
function AllocationWithdrawals({vault}:{vault:Vault}) {
  const connectedWallet=useWalletTransactions(),wallet=connectedWallet?.browser?null:connectedWallet;
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  async function withdraw(id:string) {
    if(!wallet||busy) return;
    setBusy(true);
    try {const tx=await wallet.execute({kind:'withdraw',allocation:id});setStatus(`Withdrawal broadcast: ${tx.txid}. Awaiting confirmation.`);}
    catch(error){setStatus(String(error));}finally{setBusy(false);}
  }
  return <section><h2>Independent stake withdrawals</h2>{vault.allocations.length?vault.allocations.map(a=><div key={a.id}><code>{short(a.id)}</code> · {tokenUnits(a.stake)} units · matures {utc(a.maturity)} <button type="button" disabled={!wallet||busy||!a.eligible||!!a.withdrawal} onClick={()=>{void withdraw(a.id);}}>{a.withdrawal?'Withdrawn':'Withdraw stake'}</button></div>):<p>No winning allocations yet.</p>}<p role="status">{status}</p></section>;
}
function VaultDetails({vault:v,data,stale}:{vault:Vault;data:Envelope;stale:boolean}) {
  const offers=competingOffers(v), inactive=v.offers.filter(o=>!offers.some(r=>r.slot===o.slot));
  return <><a className="back-link" href="#/">← All vaults</a><div className="page-title"><div><p className="eyebrow">VAULT TERMS</p><h1>Vault {short(v.category)}</h1><span className="badge">{vaultStatus(v,data.tip)}{stale?' · at snapshot':''}</span></div><div className="action"><a className="button" href={`${vaultHref(v.category)}/offer`}>Make an Offer</a><small>Experimental · wallet-authorized chipnet transactions</small></div></div>
    <section className="panel"><dl className="terms"><Term label="Maximum reward per period"><strong className="amount">{bch(v.config.cap)} BCH</strong></Term><Term label="Reward asset">Native BCH</Term><Term label="Staking asset"><Asset category={v.config.stakingCategory}/></Term><Term label="Period length">{periodLength(v.config.periodSeconds)}<small>{tokenUnits(v.config.periodSeconds)} seconds</small></Term><Term label="Total periods">{v.config.periods}</Term><Term label={stale?'Period at snapshot':'Current period'}>{v.period>=v.config.periods?'Completed':`${v.period+1} of ${v.config.periods}`}<small>{v.period} settled</small></Term></dl><p className="panel-note">Vault terms are immutable after publication. Rewards are native BCH. This v1 vault uses native BCH rewards. Generalized asset choices use separate v2 vaults.</p></section>
    <section className="conditions"><h2>Staking conditions</h2><ul><li>Commit S × W tokens upfront. Each win locks S separately for T periods; losing consumes no stake.</li><li>Stake: 1,000–1,000,000 raw units. Lock duration and maximum wins: 1–{v.config.periods} each.</li><li>Requested reward: 0.00001000–{bch(v.config.cap)} BCH per winning period. Rewards are not guaranteed.</li><li>16 lifetime registrations. {v.offers.length} registered. {v.phase==='activated'?'Registration is paused while the current period is activated.':'Registration requires an open phase and an unfinished schedule.'}</li><li>Each winning lock matures at its winning period’s scheduled boundary plus T periods, using chain time. Cancellation does not unlock allocated stakes or change a frozen roster.</li></ul></section>
    <section className="panel offer-panel"><div className="section-title"><div><h2>{v.period>=v.config.periods?'Final roster ranking':'Competing offers'}</h2><p>P = S × T / R. Higher priority ranks first; exact ties go to earlier canonical registration.</p></div><span className="badge">{v.phase==='activated'?'Frozen period roster':'Provisional roster'}{stale?' · not current':''}</span></div><p className="ranking-note">R is measured in satoshis; displayed priorities truncate to six decimals. {v.phase==='activated'?'This ranking uses the activated snapshot; later cancellations affect future periods.':'Eligibility freezes when a period activates.'}</p>{offers.length?<OfferTable offers={offers}/>:<State title="No competing offers">No eligible offers are present in this indexed roster.</State>}</section>
    {!!inactive.length&&<details className="advanced"><summary>Inactive live registrations ({inactive.length})</summary><OfferTable offers={inactive} inactive/></details>}
    <AllocationWithdrawals vault={v}/>{data.chain==='chipnet'&&<p><a href={vaultShareLink(v.category,v.config)}>Share this vault for verified local import</a></p>}<details className="advanced"><summary>Advanced vault information</summary><dl className="technical"><Term label="Vault category"><code>{v.category}</code></Term><Term label="Staking category"><code>{v.config.stakingCategory}</code></Term><Term label="Schedule starts (UTC)">{utc(v.config.epoch)}</Term><Term label="Protocol period index">{v.period} (zero-based)</Term><Term label="Phase">{v.phase}</Term><Term label="Indexed chain MTP">{data.tip?utc(data.tip.mtp):'Unavailable'}</Term><Term label="State outpoint"><code>{v.stateOutpoint}</code></Term><Term label="Genesis transaction"><code>{v.config.genesis}</code></Term><Term label="Indexed BCH reserve">{bch(v.bchSatoshis)} BCH</Term></dl><p>Registration order is canonical state-spend order, not browser time or mempool arrival. Indexer projections can change after a reorganization.</p></details>
  </>;
}
function OfferForm({vault:v}:{vault:Vault}) {
  const wallet=useWalletTransactions();
  const [funding,setFunding]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  async function submit() {
    if(!wallet || busy) return;
    setBusy(true);
    try {
      const [txid,vout]=funding.split(':');
      const terms={stake:Number(s),duration:Number(t),reward:Number(rewardSatoshis(r)),maxWins:Number(w)};
      setStatus('Approve preparation of exact token escrow in your wallet.');
      const prepared=await wallet.execute({kind:'prepare-offer',funding:{txid,vout:Number(vout)},amount:(BigInt(s)*BigInt(w)).toString()});
      setStatus('Escrow preparation broadcast. Approve offer registration in your wallet.');
      const offer=await wallet.execute({kind:'offer',category:v.category,funding:{txid:prepared.txid,vout:0},terms});
      setStatus(`Offer broadcast: ${offer.txid}. Awaiting confirmation.`);
    } catch(error) {setStatus(String(error));} finally {setBusy(false);}
  }

  const [s,setS]=useState(''),[t,setT]=useState(''),[r,setR]=useState(''),[w,setW]=useState('');
  const result=offerPreview(s,t,r,w,v),touched=!!(s||t||r||w);
  return <><a className="back-link" href={vaultHref(v.category)}>← Vault details</a><div className="page-title"><div><p className="eyebrow">STAKER</p><h1>Make an Offer</h1><p>Plan your terms for vault {short(v.category)}.</p></div></div><PreviewNote/>
    <form className="form-panel" onSubmit={e=>e.preventDefault()}><div className="form-grid">
      <label>Stake amount S<input inputMode="numeric" maxLength={30} placeholder="e.g. 3000" value={s} onChange={e=>setS(e.target.value)}/><small>Raw units of staking token {short(v.config.stakingCategory)}</small></label>
      <label>Lock duration T<input inputMode="numeric" maxLength={2} placeholder={`1–${v.config.periods}`} value={t} onChange={e=>setT(e.target.value)}/><small>Whole periods per winning allocation</small></label>
      <label>Reward requested R (BCH)<input inputMode="decimal" maxLength={25} placeholder="e.g. 0.00001000" value={r} onChange={e=>setR(e.target.value)}/><small>Per winning period · maximum {bch(v.config.cap)} BCH</small></label>
      <label>Maximum wins W<input inputMode="numeric" maxLength={2} placeholder={`1–${v.config.periods}`} value={w} onChange={e=>setW(e.target.value)}/><small>Stake is committed upfront for every possible win</small></label>
    </div><div className="calculation" aria-live="polite"><dl><Term label="Calculated priority P = S × T / R"><output>{result.score??'—'}</output></Term><Term label="Required upfront commitment S × W"><output>{result.commitment!==undefined?`${tokenUnits(result.commitment)} raw token units`:'—'}</output></Term></dl><p>Priority uses R in satoshis. Commitment excludes BCH transaction fees and carrier costs. This estimate does not reserve a slot or guarantee eligibility.</p>{touched&&result.error&&<p className="field-error" role="status">{result.error}</p>}</div>
    <p className="muted">Wallet signature and a valid on-chain registration will be required. {v.period>=v.config.periods?'This vault’s schedule is complete.':v.phase==='activated'?'Registration is currently paused in the indexed state.':v.offers.length>=16?'This vault has reached its lifetime registration capacity.':'Terms must still satisfy the canonical state when submitted.'}</p><label>Wallet token funding outpoint<input value={funding} onChange={e=>setFunding(e.target.value)} placeholder="transaction ID:output index"/><small>Receive address index 0; requires S × W tokens and at least 15,000 satoshis.</small></label><button className="button" type="button" disabled={!wallet||busy||!!result.error||!result.commitment||!/^[a-f0-9]{64}:\d+$/i.test(funding)} onClick={()=>{void submit();}}>{busy?'Awaiting wallet…':'Make an Offer'}</button><p role="status">{status}</p></form></>;
}
function CreateForm() {
  const wallet=useWalletTransactions();
  const [funding,setFunding]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[created,setCreated]=useState<Record<string,unknown>|null>(()=>{try{return JSON.parse(localStorage.getItem('staking-arena-pending-chipnet-genesis')??'null');}catch{return null;}});
  async function admit() {
    if(!created) return;
    try { await transactionApi('admit',{config:created}); localStorage.removeItem('staking-arena-pending-chipnet-genesis'); setStatus('Vault genesis confirmed and admitted. Refresh the vault list.'); }
    catch(error){setStatus(String(error));}
  }
  async function submit() {
    if(!wallet||busy) return;
    setBusy(true);
    try {
      const parameters={stakingCategory:asset,epoch:start/1000,periodSeconds:Number(l),periods:Number(n),cap:Number(c)};
      const [txid,vout]=funding.split(':');
      setStatus('Approve vault reward funding in your chipnet wallet.');
      const funded=await wallet.execute({kind:'create',funding:{txid,vout:Number(vout)},parameters,reserve:(c!*n!+150000n+22000n*n!).toString()});
      const genesis=await transactionApi('genesis',{parameters,pregenesis:funded.txid});
      const pending={...parameters,genesis:genesis.txid};
      localStorage.setItem('staking-arena-pending-chipnet-genesis',JSON.stringify(pending));setCreated(pending);
      setStatus(`Genesis broadcast: ${genesis.txid}. After confirmation, admit the vault below.`);
    } catch(error){setStatus(String(error));} finally {setBusy(false);}
  }

  const [asset,setAsset]=useState(''),[cap,setCap]=useState(''),[length,setLength]=useState('86400'),[periods,setPeriods]=useState(''),[epoch,setEpoch]=useState('');
  const c=rewardSatoshis(cap),n=integer(periods),l=integer(length),start=epoch?Date.parse(epoch+'Z'):NaN;
  const valid=/^[a-f0-9]{64}$/i.test(asset)&&c!==null&&c>=1000n&&c<=1000000n&&n!==null&&n>=1n&&n<=16n&&l!==null&&l>0n&&l<=2147483647n&&Number.isFinite(start)&&start/1000>=500000000&&start/1000+(2*Number(n)-1)*Number(l)<=2147483647;
  const touched=!!(asset||cap||periods||epoch);
  return <><a className="back-link" href="#/">← All vaults</a><div className="page-title"><div><p className="eyebrow">VAULT CREATOR</p><h1>Create Vault</h1><p>Set the terms once. They become immutable after publication.</p></div></div><PreviewNote/>
    <form className="form-panel" onSubmit={e=>e.preventDefault()}><div className="form-grid">
      <label>Reward asset<select disabled value="bch"><option value="bch">Native BCH</option></select><small>CashToken rewards are a future protocol feature, currently unsupported.</small></label>
      <label>Staking asset category<input value={asset} onChange={e=>setAsset(e.target.value)} maxLength={64} spellCheck={false} placeholder="64-character CashToken category"/><small>Existing fungible CashToken category; no token is created here.</small></label>
      <label>Maximum reward per period (BCH)<input inputMode="decimal" maxLength={25} value={cap} onChange={e=>setCap(e.target.value)} placeholder="0.00001000–0.01000000"/><small>1,000–1,000,000 satoshis</small></label>
      <label>Period duration (seconds)<input inputMode="numeric" maxLength={10} value={length} onChange={e=>setLength(e.target.value)}/><small>Daily: 86400 · weekly: 604800</small></label>
      <label>Number of periods<input inputMode="numeric" maxLength={2} value={periods} onChange={e=>setPeriods(e.target.value)} placeholder="1–16"/></label>
      <label>Schedule starts (UTC)<input type="datetime-local" value={epoch} onChange={e=>setEpoch(e.target.value)}/><small>Entered time is interpreted as UTC.</small></label>
    </div><div className="calculation" aria-live="polite"><dl><Term label="Minimum reward budget"><output>{valid?`${bch(c!*n!)} BCH`:'—'}</output></Term><Term label="Period duration">{l!==null&&l>0n&&l<=2147483647n?periodLength(Number(l)):'—'}</Term></dl><p>Budget = maximum reward × total periods. Fees and carrier costs are additional. All vault settings become immutable after publication.</p>{touched&&!valid&&<p className="field-error" role="status">Enter an existing 64-character token category, a valid reward cap, 1–16 periods, a positive whole-second duration and a UTC start within the protocol’s timestamp range.</p>}</div><p className="muted">Publication will require a wallet-authorized transaction, funded rewards and canonical genesis verification. The node verifies funding on chipnet before requesting a wallet signature.</p><label>Wallet BCH funding outpoint<input value={funding} onChange={e=>setFunding(e.target.value)} placeholder="transaction ID:output index"/><small>Receive address index 0; budget plus 164,000 + 22,000 × periods satoshis for reserve, fees and change.</small></label><button className="button" type="button" disabled={!wallet||!valid||busy||!/^[a-f0-9]{64}:\d+$/i.test(funding)} onClick={()=>{void submit();}}>{busy?'Awaiting wallet…':'Create Vault'}</button>{created&&<button type="button" onClick={()=>{void admit();}}>Admit confirmed genesis</button>}<p role="status">{status}</p></form></>;
}
export default function App() {
  const [transactions,setTransactions]=useState<WalletTransactions|null>(null);
  const live=useArena(),[route,setRoute]=useState(()=>routeFromHash(window.location.hash));
  useEffect(()=>{const change=()=>{setRoute(routeFromHash(window.location.hash));window.scrollTo({top:0,behavior:'instant'});};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const stale=live.fromSnapshot?'Saved confirmed snapshot from a previous visit. Historical data, not current; the chain state has not been verified.':staleReason(live.data,live.now,live.error);
  const vault='id' in route?live.data?.vaults.find(v=>v.category===route.id||v.config.genesis===route.id):undefined;
  const getRequiredNetwork = () => {
    const selected = routeFromHash(window.location.hash);
    return 'id' in selected ? requiredNetworkForVault(live.data, live.data?.vaults.find(v=>v.category===selected.id||v.config.genesis===selected.id)?.category??selected.id) : CHIPNET_NETWORK;
  };
  const unavailable=<State title={live.pending?'Loading vaults…':'Vault data unavailable'}>{live.pending?'Reading confirmed vault terms from the indexer.':'No confirmed vault data is available for this view. The indexer may be offline; no available vaults have been invented.'}</State>;
  return <WalletTransactionsContext.Provider value={transactions}><div className="app"><a className="skip-link" href="#content" onClick={e=>{e.preventDefault();document.getElementById('content')?.focus();}}>Skip to content</a><header className="header"><a className="brand" href="#/" aria-label="Staking Arena home"><img src="./arena.svg" alt="" width="32" height="32"/>Staking Arena</a><nav aria-label="Main navigation"><a href="#/">Vaults</a><a href="#/v2">Generalized assets v2</a><span>{live.data?.chain==='regtest'?'Regtest reference':'CHIPNET — TEST FUNDS ONLY'}</span>{live.source!=='off'?<WalletConnect browser={live.source==='electrum'} onTransactions={setTransactions} getRequiredNetwork={getRequiredNetwork} targetLabel={'id' in route ? 'Selected vault' : 'Application'}/>:<span>Offline preview</span>}</nav></header><main id="content" tabIndex={-1}>
    <div className="data-status"><span>{live.data?(stale?'Last-known confirmed snapshot · not current':'Confirmed indexer data'):live.configured?(live.pending?'Connecting to indexer':(live.source==='electrum'?'Disconnected · Electrum unavailable':'Offline · API unavailable')):'Offline · no API configured'}</span><button type="button" className="refresh" onClick={live.refresh} disabled={live.pending||!live.configured}>{live.pending?'Refreshing…':'Refresh data'}</button></div>
    {live.source==='electrum'&&<><p className="provider-status" role="status" data-testid="electrum-status">Browser Electrum · chipnet · {live.providerStatus}</p><details className="advanced"><summary>Electrum trust assumptions</summary><p>Transaction hashes, inclusion proofs, header links and vault state are checked in your browser. The server selects the chain and supplies transaction history and UTXO data. Complete history and non-spending cannot be cryptographically proven through Electrum. This is not full node consensus validation. Saved data is historical until a new sync succeeds. Wallet-authorized creation and offers use explicit WizardConnect approval, followed by local transaction and current-input checks. Period processing validates covenants locally and checks two Electrum endpoints, while retaining these server-trust assumptions.</p></details></>}
    {live.source==='electrum'&&<section className="warning" aria-label="Experimental wallet features"><strong>EXPERIMENTAL — Create Vault and Make an Offer</strong><p>These wallet transaction flows have not yet passed a real-wallet end-to-end test. Use chipnet test funds only. Funding is irreversible and committed BCH has no creator refund path. Each wallet spend requires explicit approval.</p><p>Public listings are configured or imported locally; this is not globally complete discovery. Permissionless period processing remains independent.</p></section>}
    {stale&&<div className="warning" role="alert"><strong>{live.data?'Historical snapshot · not current':'Offline mode'}</strong><p>{stale}</p>{live.error&&<p>{live.error}</p>}</div>}
    {live.receivedAt&&<p className="snapshot-time">{stale?'Snapshot fetched':'Fetched'} {new Date(live.receivedAt).toISOString()} · Indexer synchronized {live.data?.health.updatedAt||'unknown'}</p>}
    {live.source==='electrum'&&<VaultImport/>}
    {route.page==='v2'?<Suspense fallback={<p role="status">Loading v2 vaults…</p>}><GeneralizedAssets/></Suspense>:route.page==='home'?<><div className="hero"><div><p className="eyebrow">THE VAULT MARKETPLACE</p><h1>Staking Arena</h1><p>Explore vault terms. Compare offers. Choose your commitment.</p></div><div className="action"><a className="button" href="#/create">Create Vault</a><a href="#/v2">Choose BCH or CashToken assets in v2</a><small>Experimental · wallet-authorized chipnet transactions</small></div></div><div className="list-heading"><h2>Vaults</h2><span>{live.data?`${live.data.vaults.length} indexed`:'Confirmed listings only'}</span></div>{!live.data?unavailable:live.data.vaults.length?<VaultList data={live.data} stale={!!stale}/>:<State title="No vaults listed">The indexer has no admitted vaults. Only confirmed indexed vaults appear here.</State>}</>:route.page==='create'?(live.source==='electrum'?<BrowserCreateForm/>:<CreateForm/>):route.page==='missing'?<State title="Page not found"><a href="#/">Return to vaults</a></State>:!live.data?unavailable:!vault?(live.pending||stale||live.error?unavailable:<State title="Vault not found">This vault is not in the indexed response{stale?' (which is historical and may be incomplete)':''}. <a href="#/">Return to vaults</a></State>):route.page==='offer'?(live.source==='electrum'?<BrowserOfferForm key={vault.category} vault={vault}/>:<OfferForm key={vault.category} vault={vault}/>):<VaultDetails vault={vault} data={live.data} stale={!!stale}/>}
    {live.source==='electrum'&&route.page==='vault'&&vault&&<SettlementStatus status={live.settlements[vault.category]} automatic={live.automatic} onAutomatic={live.setAutomatic} onProcess={()=>live.processPeriod(vault.category)} disabled={!!stale||vault.period>=vault.config.periods}/> }
    {live.source==='api'&&<TransactionStatus/>}<footer>Staking Arena · CHIPNET — TEST FUNDS ONLY</footer></main></div></WalletTransactionsContext.Provider>;
}
