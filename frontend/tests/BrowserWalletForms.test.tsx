import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {BrowserCreateForm,BrowserOfferForm} from '../src/BrowserWalletForms';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
import {fixture} from './fixture';
const asset='a'.repeat(64),client=():WalletTransactions=>({browser:true,publicKey:()=> '03b8862eaed4d4fba715b9b0b8cb0ccefea32841fcbcf847be960e34545de1fd25',inventory:vi.fn(async()=>({coins:[],bch:'200000',tokens:{[asset]:'5000'},addresses:63,gap:20,limit:40,bounded:true as const})),operations:async()=>[],execute:vi.fn(async()=>({txid:'b'.repeat(64),status:'pending'}))});
const fill=(label:RegExp|string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
it('requires explicit funding review and approval; shows exact lifecycle quote without a backend',async()=>{
 const wallet=client(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Period duration/,'60');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2026-11-12T00:00');
 expect(screen.getByText('0.00082000 BCH (82000 satoshis)')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'}));});expect(wallet.execute).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review funding in wallet'}));});expect(wallet.execute).toHaveBeenCalledWith(expect.objectContaining({kind:'create',parameters:expect.objectContaining({cap:2000,periods:2})}));expect(fetcher).not.toHaveBeenCalled();
});
it('reviews S×W deposit, refuses invalid/closed offers and displays wallet rejection without retry signing',async()=>{
 const wallet=client();vi.mocked(wallet.execute).mockRejectedValue(Error('Wallet rejected signing'));
 const vault={...fixture().vaults[0],config:{...fixture().vaults[0].config,epoch:Math.floor(Date.now()/1000)+3600,stakingCategory:asset,periods:2,cap:2000},offers:[]};
 const mounted=render(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={vault} tip={{...fixture().tip!,mtp:Math.floor(Date.now()/1000)}} stale={false}/></WalletTransactionsContext.Provider>);
 fill('Stake amount S','1000');fill('Lock duration T','1');fill('Reward requested R (BCH)','0.00003000');fill('Maximum wins W','2');await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'}));});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();
 fill('Reward requested R (BCH)','0.00001000');expect(screen.getByText('2,000 raw token units')).toBeInTheDocument();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review offer funding in wallet'}));});await screen.findByText('Error: Wallet rejected signing');expect(wallet.execute).toHaveBeenCalledOnce();
 mounted.rerender(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={{...vault,phase:'activated'}} tip={{...fixture().tip!,mtp:Math.floor(Date.now()/1000)}} stale={false}/></WalletTransactionsContext.Provider>);expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Registration is unavailable');
});
it('ignores a superseded worker startup error when the live wallet client replaces it',async()=>{
 let rejectOld!:(error:Error)=>void;
 const old=client();old.operations=()=>new Promise((_resolve,reject)=>{rejectOld=reject;});
 const mounted=render(<WalletTransactionsContext.Provider value={old}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 mounted.rerender(<WalletTransactionsContext.Provider value={client()}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 await act(async()=>{rejectOld(Error('Wallet worker closed'));});
 expect(screen.queryByText(/Wallet worker closed/)).not.toBeInTheDocument();
});
it('clears a verified balance on failed refresh, displays retry progress, and enables funding only after recovery',async()=>{
 const wallet=client();render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Period duration/,'60');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2026-11-12T00:00');
 const review=screen.getByRole('button',{name:'Review funding in wallet'}),scan=screen.getByRole('button',{name:'Check wallet balances'});
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));expect(review).toBeEnabled();
 let rejectScan!:(error:Error)=>void;vi.mocked(wallet.inventory!).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectScan=reject;}));
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeDisabled();
 act(()=>window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Normal new block; retrying both providers (2/3)'})));
 expect(screen.getByText(/retrying both providers/)).toBeInTheDocument();
 await act(async()=>rejectScan(Error('Wallet balances could not be verified after 3 attempts. Check wallet balances again.')));
 expect(review).toBeDisabled();expect(screen.getByText(/could not be verified after 3 attempts/)).toBeInTheDocument();
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeEnabled();expect(wallet.execute).not.toHaveBeenCalled();
});

it('disables offer submission for an overdue or expired UTC schedule even while chain MTP lags',async()=>{
 const wallet=client(),epoch=Math.floor(Date.now()/1000)-600;
 const vault={...fixture().vaults[0],period:0,phase:'open' as const,config:{...fixture().vaults[0].config,epoch,periodSeconds:300,periods:2},offers:[]};
 render(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={vault} tip={{...fixture().tip!,mtp:epoch-1}} stale={false}/></WalletTransactionsContext.Provider>);
 expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('scheduled cutoff');expect(wallet.execute).not.toHaveBeenCalled();
});
