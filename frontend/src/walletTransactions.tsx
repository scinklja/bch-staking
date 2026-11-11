import { rememberTransaction } from './TransactionStatus';
import { stringify } from '@bitauth/libauth';
import { createContext, useContext } from 'react';
import { apiBaseUrl } from './api';
export interface WalletTransactions {
  publicKey(): string;
  execute(intent: Record<string,unknown>): Promise<{txid:string;status:string}>;
}
export const WalletTransactionsContext = createContext<WalletTransactions|null>(null);
export const useWalletTransactions = () => useContext(WalletTransactionsContext);
export async function transactionApi(endpoint: string, data: unknown): Promise<any> {
  const base = apiBaseUrl();
  if (!base) throw Error('Chipnet transaction backend is unavailable');
  const response = await fetch(`${base}/transactions/${endpoint}`, { method:'POST',headers:{'content-type':'application/json','x-arena-network':'chipnet'},body:JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { const error=result.error??'Chipnet transaction failed';window.dispatchEvent(new CustomEvent('arena-transaction-error',{detail:error}));throw Error(error); }
  if(result.txid)rememberTransaction(result.txid);
  return result;
}

/** The installed WizardConnect relay uses JSON.stringify without native-type conversion. */
export function wizardWireTransaction<T>(request: T): T {
  return JSON.parse(stringify(request)) as T;
}
