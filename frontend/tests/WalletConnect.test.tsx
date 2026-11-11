import { EventEmitter } from 'node:events';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { initiateDappRelay, PROTOCOL_NAME, RelayMsgAction } from '@wizardconnect/core';
import WalletConnect from '../src/WalletConnect';

// Exercise the real SDK hook and handshake manager with a local relay transport.
vi.mock('@wizardconnect/core', async importOriginal => ({
  ...await importOriginal<typeof import('@wizardconnect/core')>(),
  initiateDappRelay: vi.fn(),
}));
const sessionKey = 'staking-arena-wizardconnect-v1';
const client = Object.assign(new EventEmitter(), {
  relay: vi.fn(async (_message: { action: string }) => {}),
  isKeyExchangeComplete: () => true,
  setPeerCapabilities: vi.fn(),
});
const cleanup = vi.fn();
const events = new EventEmitter();
const uri = 'wiz://test-pairing';

beforeEach(() => {
  client.removeAllListeners();
  events.removeAllListeners();
  cleanup.mockClear();
  client.relay.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.mocked(initiateDappRelay).mockReset().mockReturnValue({
    uri, qrUri: 'WIZ://TEST-PAIRING', client, events, cleanup,
    credentials: { privateKey: 'test-private-key', secret: 'test-secret' },
  } as unknown as ReturnType<typeof initiateDappRelay>);
});

async function walletReady() {
  await act(async () => {
    const callback = vi.mocked(initiateDappRelay).mock.calls.at(-1)![0];
    callback({ client, status: { status: 'connected' } } as unknown as Parameters<typeof callback>[0]);
    events.emit('keyexchangecomplete', new Uint8Array([1, 2]));
    client.emit('message', {
      action: RelayMsgAction.WalletReady,
      wallet_name: 'Test BCH Wallet', wallet_icon: '', dapp_discovered: true,
      supported_protocols: [PROTOCOL_NAME], session: { [PROTOCOL_NAME]: { paths: [] } },
    });
  });
}

it('starts pairing only on click and cancels with cleanup and cleared credentials', async () => {
  render(<WalletConnect/>);
  expect(initiateDappRelay).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Connection URI' })).toHaveValue(uri);
  expect(screen.getByRole('link', { name: 'Open wallet' })).toHaveAttribute('href', uri);
  expect(localStorage.getItem(sessionKey)).toContain('test-private-key');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel wallet connection' }));
  await screen.findByRole('button', { name: 'Connect Wallet' });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(localStorage.getItem(sessionKey)).toBeNull();
});

it('handles a real SDK wallet-ready handshake, persists the session and disconnects', async () => {
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  await walletReady();
  expect(screen.getByText('Connected to Test BCH Wallet')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(sessionKey)!)).toMatchObject({ walletName: 'Test BCH Wallet', walletPublicKey: '0102' });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  await screen.findByRole('button', { name: 'Connect Wallet' });
  expect(client.relay).toHaveBeenCalledWith(expect.objectContaining({ action: RelayMsgAction.Disconnect }));
  expect(client.relay.mock.calls.every(([message]) => message.action !== RelayMsgAction.SignTransactionRequest)).toBe(true);
  expect(localStorage.getItem(sessionKey)).toBeNull();
});

it('restores a paired session without showing another QR code', async () => {
  localStorage.setItem(sessionKey, JSON.stringify({ privateKey: 'saved-key', secret: 'saved-secret', walletPublicKey: '0102', walletName: 'Test BCH Wallet' }));
  render(<WalletConnect/>);
  expect(screen.getByText('Reconnecting to wallet…')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(initiateDappRelay).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ existingCredentials: { privateKey: 'saved-key', secret: 'saved-secret', walletPublicKey: '0102' } }));
  await walletReady();
  expect(screen.getByText('Connected to Test BCH Wallet')).toBeInTheDocument();
});

it('shows startup errors and allows retry', async () => {
  vi.mocked(initiateDappRelay).mockImplementationOnce(() => { throw Error('Relay unavailable'); });
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Wallet connection failed. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('offers manual copying when the clipboard is unavailable', async () => {
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy connection URI' }));
  await screen.findByText('Select and copy the connection URI below.');
});
