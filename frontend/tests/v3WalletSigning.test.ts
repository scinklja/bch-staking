import {expect,it,vi} from 'vitest';
import {browserWalletClient} from '../src/browserWalletClient';
import {v3Call} from '../src/v3Client';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn()}));
function setup(reject=false){
 class WorkerMock {onmessage:((event:any)=>void)|null=null;terminate=vi.fn();constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}postMessage(m:any){queueMicrotask(()=>this.onmessage?.({data:{id:m.id,result:m.method==='list'?[]:undefined}}));}}
 vi.stubGlobal('Worker',WorkerMock);
 const publicKey=Uint8Array.of(2,...new Uint8Array(32).fill(1)),owner={publicKey:Array.from(publicKey,x=>x.toString(16).padStart(2,'0')).join('')},request={broadcast:false,userPrompt:'Caller fee approval',transaction:{version:2,inputs:[],outputs:[],locktime:0},sourceOutputs:[]},plan={label:'Claim; caller pays 10000 sats',request,inputPaths:[[3,'receive',0]]};
 const manager={getSessionPaths:()=>[0],hasPath:(p:number)=>p===0,getPubkey:()=>publicKey,signTransaction:vi.fn(async()=>reject?{error:'User rejected'}:{signedTransaction:'signed'})};
 vi.mocked(v3Call).mockImplementation(async intent=>{if(intent.operation==='claim'||intent.operation==='resume')return {id:'claim',stage:'review',plan};if(intent.operation==='authorize')return {owner,verifiedAt:Date.now(),plan};if(intent.operation==='submit')return {id:'claim',stage:'pending'};return [];});
 return {wallet:browserWalletClient(manager as any,()=>{}),manager,request};
}
it('Cashonize is asked to sign only the fee input with broadcast disabled; worker validates before broadcast',async()=>{
 const {wallet,manager,request}=setup();try{const result=await wallet.v3!({operation:'claim',config:{}});expect(manager.signTransaction).toHaveBeenCalledTimes(1);expect(manager.signTransaction).toHaveBeenCalledWith({transaction:request,inputPaths:[[3,'receive',0]]},{signal:expect.any(AbortSignal)});expect(v3Call).toHaveBeenCalledWith({operation:'submit',id:'claim',raw:'signed'},[]);expect(result.stage).toBe('pending');}finally{wallet.close?.();}
});
it('wallet rejection persists an unsigned error without submitting or automatically retrying',async()=>{
 const {wallet,manager}=setup(true);try{await expect(wallet.v3!({operation:'claim',config:{}})).rejects.toThrow(/refused/);expect(v3Call).toHaveBeenCalledWith({operation:'signingFailed',id:'claim',error:expect.stringContaining('refused')},[]);expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='submit')).toBe(false);expect(manager.signTransaction).toHaveBeenCalledTimes(1);}finally{wallet.close?.();}
});
it('reconciling a signed uncertain claim never requests another wallet signature',async()=>{
 const {wallet,manager}=setup();vi.mocked(v3Call).mockResolvedValue({id:'claim',raw:'signed',stage:'prepared'});try{await wallet.v3!({operation:'resume',id:'claim'});expect(manager.signTransaction).not.toHaveBeenCalled();}finally{wallet.close?.();}
});
