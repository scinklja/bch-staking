import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import SettlementStatus from '../src/SettlementStatus';
import type {SettlementPhase} from '../../src/browser-keeper';
it('shows settlement lifecycle, blocks unsafe fee funding and exposes controls without wallet signing',()=>{
 const automatic=vi.fn(),process=vi.fn();
 const props={automatic:false,onAutomatic:automatic,onProcess:process,disabled:false};
 const view=render(<SettlementStatus {...props}/>);
 fireEvent.click(screen.getByRole('checkbox'));expect(automatic).toHaveBeenCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'Process Period'}));expect(process).toHaveBeenCalledOnce();
 const labels:Record<SettlementPhase,string>={waiting:'Waiting for the next period','activation-required':'Activation required','settlement-required':'Settlement required',broadcasting:'Broadcasting',pending:'Pending confirmation',confirmed:'Confirmed',retrying:'Failed or retrying',blocked:'Blocked: safe fee funding unavailable',complete:'All periods processed'};
 for(const phase of Object.keys(labels) as SettlementPhase[]){view.rerender(<SettlementStatus {...props} status={{phase,message:'verified status',updatedAt:new Date().toISOString(),txid:'a'.repeat(64)}}/>);expect(screen.getByTestId('settlement-status')).toHaveTextContent(labels[phase]);}
 expect(screen.queryByText(/WizardConnect/)).not.toBeInTheDocument();
});
it('disables processing while pending or stale and does not equate acceptance with confirmation',()=>{
 render(<SettlementStatus automatic disabled onAutomatic={()=>{}} onProcess={()=>{}} status={{phase:'pending',message:'Broadcast accepted',updatedAt:'',txid:'b'.repeat(64)}}/>);
 expect(screen.getByRole('button',{name:'Process Period'})).toBeDisabled();expect(screen.getByText(/confirmation is not implied by broadcast/)).toBeInTheDocument();
});
