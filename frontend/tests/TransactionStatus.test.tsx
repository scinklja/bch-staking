import {act,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import TransactionStatus,{rememberTransaction} from '../src/TransactionStatus';
it('shows confirmations, detects disappearing confirmed transactions and labels API outages',async()=>{
 const txid='ab'.repeat(32);rememberTransaction(txid);
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({chain:'chipnet',txid,status:'confirmed',confirmations:2}),{status:200}));vi.stubGlobal('fetch',fetcher);
 render(<TransactionStatus/>);
 await waitFor(()=>expect(screen.getByText(/Confirmed · 2 confirmation/)).toBeInTheDocument());
 fetcher.mockResolvedValue(new Response('{}',{status:404}));
 act(()=>window.dispatchEvent(new Event('arena-transactions')));
 await screen.findByText(/possible reorg, dropped or replaced/);expect(screen.queryByText(/2 confirmation/)).not.toBeInTheDocument();
 fetcher.mockRejectedValue(Error('offline'));
 act(()=>window.dispatchEvent(new Event('arena-transactions')));
 await screen.findByText(/unavailable — last result may be stale/);
});

it('distinguishes submitted receipts from observed zero-confirmation transactions',async()=>{
 const txid='cd'.repeat(32);rememberTransaction(txid);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({chain:'chipnet',txid,status:'pending',confirmations:0}),{status:200})));
 render(<TransactionStatus/>);
 expect(screen.getByText(/Broadcast submitted, awaiting observation/)).toBeInTheDocument();
 await screen.findByText(/Unconfirmed \(0-conf\)/);
});

it('rejects a provider response that calls a zero-confirmation transaction confirmed',async()=>{
 const txid='ef'.repeat(32);rememberTransaction(txid);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({chain:'chipnet',txid,status:'confirmed',confirmations:0}),{status:200})));
 render(<TransactionStatus/>);await screen.findByText(/unavailable — last result may be stale/);expect(screen.queryByText(/Confirmed/)).not.toBeInTheDocument();
});
