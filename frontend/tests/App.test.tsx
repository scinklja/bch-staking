import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import App from '../src/App';
import { fixture } from './fixture';
import { REFRESH_MS } from '../src/useArena';
afterEach(()=>{vi.useRealTimers();window.location.hash='';});
const response=(data:unknown)=>Promise.resolve(new Response(JSON.stringify(data),{status:200}));
it('renders native BCH reserves, all offers and historical snapshots through the documented endpoint',async()=>{
  const fetcher=vi.fn<typeof fetch>(()=>response(fixture()));vi.stubGlobal('fetch',fetcher);
  render(<App/>);await screen.findByText('Native BCH reserves');
  expect(screen.getAllByText('0.00090000')[0]).toBeInTheDocument();expect(fetcher.mock.calls[0]?.[0]).toBe('/api/vaults');
  fireEvent.click(screen.getByRole('link',{name:'Offer marketplace'}));
  expect(screen.getByText('Every offer. One canonical order.')).toBeInTheDocument();
  expect(screen.getByText('Offer #00')).toBeInTheDocument();expect(screen.getByText('Offer #01')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link',{name:'Period history'}));
  expect(screen.getByText('2026-11-06 21:20:00 UTC')).toBeInTheDocument();
  expect(screen.getByText(/does not supply event block timestamps/)).toBeInTheDocument();
  expect(screen.getByText('Block 121')).toBeInTheDocument();expect(screen.getByText('Block 122')).toBeInTheDocument();
  const details=screen.getByText('Inspect activated snapshot').closest('details')!;
  fireEvent.click(screen.getByText('Inspect activated snapshot'));
  expect(within(details).getByText('Offer #00')).toBeInTheDocument();expect(within(details).getByText('Offer #01')).toBeInTheDocument();
});
it('shows loading, a useful empty state, and a recoverable initial error',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));const loading=render(<App/>);expect(screen.getByRole('status')).toHaveTextContent(/Reading/);loading.unmount();
  vi.stubGlobal('fetch',vi.fn(()=>response({...fixture(),vaults:[]})));const empty=render(<App/>);await screen.findByText('No admitted vaults yet');empty.unmount();
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('API unreachable')));render(<App/>);await screen.findByText('The indexer is out of reach');expect(screen.getByRole('button',{name:/Try again/})).toBeEnabled();
});
it('refreshes in place, retains the last state on failure, and recovers without reloading',async()=>{
  vi.useFakeTimers();const first=fixture();const second=fixture();second.vaults[0].bchSatoshis='80000';
  const fetcher=vi.fn().mockImplementationOnce(()=>response(first)).mockImplementationOnce(()=>Promise.reject(Error('offline'))).mockImplementation(()=>response(second));
  vi.stubGlobal('fetch',fetcher);render(<App/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(screen.getByText('Native BCH reserves')).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(REFRESH_MS);});
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');expect(screen.getAllByText('0.00090000')[0]).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(REFRESH_MS);});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getAllByText('0.00080000')[0]).toBeInTheDocument();
});
it('distinguishes locked, eligible, withdrawn and stale allocation state and filters public positions',async()=>{
  const data=fixture(),v=data.vaults[0];v.allocations.push({...v.allocations[0],id:'1'.repeat(64)+':3',eligible:true});
  v.allocations.push({...v.allocations[0],id:'2'.repeat(64)+':3',withdrawal:'3'.repeat(64)});
  vi.stubGlobal('fetch',vi.fn(()=>response(data)));render(<App/>);await screen.findByText('Native BCH reserves');
  fireEvent.click(screen.getByRole('link',{name:'Staker positions'}));
  expect(screen.getByText('Eligible at indexed MTP')).toBeInTheDocument();expect(screen.getByText('Locked at indexed MTP')).toBeInTheDocument();expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:/Filter positions/}),{target:{value:'unmatched'}});expect(screen.getByText('No matching positions')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/withdraw|deposit|sign|connect wallet/i})).not.toBeInTheDocument();
});
it('preserves eligibility in an activated snapshot when the owner cancels for future periods',async()=>{
  const data=fixture(),v=data.vaults[0];v.phase='activated';v.offers[1].cancelled=true;
  vi.stubGlobal('fetch',vi.fn(()=>response(data)));render(<App/>);await screen.findByText('Native BCH reserves');
  fireEvent.click(screen.getByRole('link',{name:'Offer marketplace'}));
  expect(screen.getByText('Cancelled for future periods')).toBeInTheDocument();expect(screen.getAllByText('Eligible in snapshot')).toHaveLength(2);
});
