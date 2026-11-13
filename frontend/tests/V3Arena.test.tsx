import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import V3Arena from '../src/V3Arena';
import {v3Call} from '../src/v3Client';
import {Buffer} from '../../src/bytes';
import {initialState,advance,type Parameters} from '../../src/v3/model';
import {offer} from '../../src/registry';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn(async()=>[])}));
const p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n},config={...p,genesis:'ab'.repeat(32)};
function stub(phase='ready',sponsor=true){const state=advance(initialState(p),0,0,offer(Buffer.from('02'+'11'.repeat(32),'hex'),3000,513,3000,2));vi.mocked(v3Call).mockImplementation(async intent=>{
 if(intent.operation==='sync')return {snapshot:{config,instance:{parameters:p,state},clock:{mtp:p.epoch+7201},pending:[],allocations:[]},next:{phase,available:4000n,reason:'Top offer exceeds available buffer'},sponsor:sponsor?{}:undefined,required:10000n,address:'bchreg:donation'};
 if(intent.operation==='claim')return {id:'cd'.repeat(32),status:'pending'};return [];
});}
async function open(){render(<V3Arena/>);fireEvent.change(screen.getByLabelText('Public v3 configuration'),{target:{value:JSON.stringify(config,(_,v)=>typeof v==='bigint'?v.toString():v)}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify and refresh chain state'})));}
it('permits a sponsored public claim without a connected wallet and labels broadcast as pending',async()=>{
 stub();await open();expect(screen.getByRole('button',{name:'Claim reward'})).toBeEnabled();expect(screen.getByRole('cell',{name:'513 / 1024'})).toBeInTheDocument();expect(screen.getByText(/Priority uses the requested T/)).toBeInTheDocument();expect(screen.getByText(/Current insertion rank:/)).toHaveTextContent('Independent lock: 4096s');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Claim reward'})));expect(v3Call).toHaveBeenCalledWith({operation:'claim',config});expect(screen.getByRole('status')).toHaveTextContent('pending');expect(screen.getByRole('status')).toHaveTextContent('Broadcast acceptance is pending');
});
it('blocks claims when the covenant buffer is insufficient and preserves the top offer',async()=>{
 stub('blocked');await open();expect(screen.getByRole('button',{name:'Claim reward'})).toBeDisabled();expect(screen.getByText(/Top offer exceeds available buffer/)).toBeInTheDocument();expect(screen.getByText('1539000 / 3000')).toBeInTheDocument();
});
it('requires public fee sponsorship even when rewards are available',async()=>{stub('ready',false);await open();expect(screen.getByRole('button',{name:'Claim reward'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('public fee sponsorship required');});
