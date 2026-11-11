import {act,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import TransactionStatus,{rememberTransaction} from '../src/TransactionStatus';
it('shows confirmations, detects disappearing confirmed transactions and labels API outages',async()=>{
 const txid='ab'.repeat(32);rememberTransaction(txid);
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({chain:'chipnet',txid,status:'confirmed',confirmations:2}),{status:200}));vi.stubGlobal('fetch',fetcher);
 render(<TransactionStatus/>);
 await waitFor(()=>expect(screen.getByText(/confirmed · 2 confirmation/)).toBeInTheDocument());
 fetcher.mockResolvedValue(new Response('{}',{status:404}));
 act(()=>window.dispatchEvent(new Event('arena-transactions')));
 await screen.findByText(/reorg-or-dropped/);
 fetcher.mockRejectedValue(Error('offline'));
 act(()=>window.dispatchEvent(new Event('arena-transactions')));
 await screen.findByText(/unavailable — last result may be stale/);
});
