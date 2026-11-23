// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignOutButton } from '../app/sign-out-button';

const { refresh, signOut } = vi.hoisted(() => ({ refresh: vi.fn(), signOut: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../src/lib/auth-client', () => ({ authClient: { signOut } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SignOutButton', () => {
  it('refreshes the page once sign-out succeeds', async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error and stays on the page when sign-out fails', async () => {
    signOut.mockResolvedValue({ data: null, error: { message: 'Service unavailable' } });
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Service unavailable');
    expect(refresh).not.toHaveBeenCalled();
  });
});
