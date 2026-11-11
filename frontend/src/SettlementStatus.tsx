import type { SettlementStatus as Status } from '../../src/browser-keeper';
const labels:Record<Status['phase'],string>={waiting:'Waiting for the next period','activation-required':'Activation required','settlement-required':'Settlement required',broadcasting:'Broadcasting',pending:'Pending confirmation',confirmed:'Confirmed',retrying:'Failed or retrying',blocked:'Blocked: safe fee funding unavailable',complete:'All periods processed'};
export default function SettlementStatus({status,automatic,onAutomatic,onProcess,disabled}:{status?:Status;automatic:boolean;onAutomatic:(value:boolean)=>void;onProcess:()=>void;disabled:boolean}) {
 return <section className="panel" aria-label="Period settlement"><h2>Period settlement</h2>
  <p role="status" data-testid="settlement-status"><strong>{status?labels[status.phase]:'Waiting for verified state'}</strong>{status&&<> · {status.message}</>}</p>
  <label><input type="checkbox" checked={automatic} onChange={event=>onAutomatic(event.target.checked)}/> Enable automatic settlement on chipnet</label>
  <p>Applies to all listed chipnet vaults while this website is open.</p>
  <p>Permissionless activation and settlement need no wallet signature. Each unsponsored transition pays 10,000 satoshis from the vault’s excess BCH; a winning settlement also funds its 2,000-satoshi allocation output. Committed reward reserves stay protected.</p>
  <button type="button" disabled={disabled||['broadcasting','pending','complete'].includes(status?.phase??'')} onClick={onProcess}>Process Period</button>
  {status?.txid&&<p>Transaction <code>{status.txid}</code> · {status.phase==='confirmed'?'confirmed on the indexed chain':'confirmation is not implied by broadcast'}</p>}
  {status?.nextRetryAt&&<p>Next reconciliation no earlier than {new Date(status.nextRetryAt).toISOString()}.</p>}
  <p className="muted">Turn automation off to stop future submissions. A transaction already sent cannot be recalled. Processing pauses when this browser is closed or suspended; independent keepers may still race.</p>
 </section>;
}
