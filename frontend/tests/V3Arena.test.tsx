import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {WalletTransactionsContext} from '../src/walletTransactions';
import V3Arena from '../src/V3Arena';
import {v3Call} from '../src/v3Client';
import {Buffer} from '../../src/bytes';
import {initialState,advance,type Parameters} from '../../src/v3/model';
import {offer} from '../../src/registry';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn(async()=>[])}));
const p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n},config={...p,genesis:'ab'.repeat(32)};
const wallet={publicKey:()=>'',execute:vi.fn(),v3:vi.fn()};
function stub(phase='ready'){const state=advance(initialState(p),0,0,offer(Buffer.from('02'+'11'.repeat(32),'hex'),3000,513,3000,2));vi.mocked(v3Call).mockImplementation(async intent=>{
 if(intent.operation==='sync')return {snapshot:{config,instance:{parameters:p,state},clock:{mtp:p.epoch+7201},pending:[],allocations:[]},next:{phase,available:4000n,reason:'Top offer exceeds available buffer'},required:10000n,minerFee:10000n,carriers:0n};
 if(intent.operation==='claim')return {id:'cd'.repeat(32),status:'pending'};return [];
});}
async function open(connected=true){render(<WalletTransactionsContext.Provider value={connected?wallet:null}><V3Arena/></WalletTransactionsContext.Provider>);fireEvent.change(screen.getByLabelText('Public v3 configuration'),{target:{value:JSON.stringify(config,(_,v)=>typeof v==='bigint'?v.toString():v)}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify and refresh chain state'})));}
it('requires explicit caller wallet approval and labels broadcast as pending',async()=>{
 stub();wallet.v3.mockResolvedValue({kind:'claim',id:'claim',step:'action',stage:'pending'});await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();expect(screen.getByRole('cell',{name:'513 / 1024'})).toBeInTheDocument();expect(screen.getByText(/Priority uses the requested T/)).toBeInTheDocument();expect(screen.getByText(/Current insertion rank:/)).toHaveTextContent('Independent lock: 4096s');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(wallet.v3).toHaveBeenCalledWith({operation:'claim',config});expect(screen.getByRole('status')).toHaveTextContent('pending');expect(screen.getByRole('status')).not.toHaveTextContent('confirmed');
});
it('blocks claims when the covenant buffer is insufficient and preserves the top offer',async()=>{
 stub('blocked');await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('Top offer exceeds available buffer');expect(screen.getByText('1539000 / 3000')).toBeInTheDocument();
});
it('requires a connected compatible wallet even when rewards are available',async()=>{stub('ready');await open(false);expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('connect a compatible WizardConnect/Cashonize wallet');});

it('surfaces wallet rejection and keeps recovery operations visible',async()=>{stub();wallet.v3.mockRejectedValue(Error('Wallet rejected signing; unsigned claim retained'));await open();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(screen.getByRole('status')).toHaveTextContent('Wallet rejected');expect(v3Call).toHaveBeenCalledWith({operation:'list'});});
