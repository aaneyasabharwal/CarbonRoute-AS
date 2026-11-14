/**
 * Account page and authentication-aware navigation (P8). Backend responses are stubbed in the API's
 * shape; the backend enforces every rule, the page shows its answers.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { AccountPage } from '../../src/pages/AccountPage';
import { Navbar } from '../../src/components/Navbar';
import { API_BASE } from '../../src/services/api';
import { stubFetch, bodyOf } from '../support/fetch';

const student = { id: 'u1', username: 'alice', email: 'alice@example.org', role: 'student' };
const admin = { id: 'u0', username: 'root', email: 'root@example.org', role: 'admin' };

function backend(user: any, over: (url: string, init?: RequestInit) => any = () => undefined) {
  return stubFetch((url, init) => {
    const o = over(url, init);
    if (o !== undefined) return o;
    if (url === `${API_BASE}/auth/me`) return { body: { success: true, user } };
    return undefined;
  });
}
const renderWith = (ui: React.ReactElement) =>
  render(
    <AuthProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthProvider>
  );

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('AccountPage', () => {
  it('signed out: asks to sign in', async () => {
    renderWith(<AccountPage />);
    expect(await screen.findByTestId('sign-in-required')).toHaveTextContent('your account');
  });

  it('change password: validates locally, stores the new token on success, and never shows the accounts admin', async () => {
    localStorage.setItem('carbonroute_token', 'old-token');
    const fetchMock = backend(student, (url, init) =>
      url === `${API_BASE}/auth/password` && init?.method === 'POST' ? { body: { success: true, message: 'Password changed. Other sessions have been signed out.', token: 'new-token' } } : undefined
    );
    renderWith(<AccountPage />);
    const section = await screen.findByRole('region', { name: 'Change password' });
    expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull();

    fireEvent.change(within(section).getByLabelText('Current password'), { target: { value: 'current-password-1' } });
    fireEvent.change(within(section).getByLabelText(/New password/), { target: { value: 'short' } });
    expect(within(section).getByText(/at least 12 characters\./)).toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText(/New password/), { target: { value: 'a-much-longer-password' } });
    fireEvent.change(within(section).getByLabelText('Repeat the new password'), { target: { value: 'different-password-x' } });
    expect(within(section).getByText('The two new passwords do not match.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Change password' })).toBeDisabled();

    fireEvent.change(within(section).getByLabelText('Repeat the new password'), { target: { value: 'a-much-longer-password' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Change password' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Other sessions have been signed out');
    expect(localStorage.getItem('carbonroute_token')).toBe('new-token');
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === `${API_BASE}/auth/password`)!;
    expect(bodyOf(call)).toEqual({ currentPassword: 'current-password-1', newPassword: 'a-much-longer-password' });
  });

  it('a wrong current password is shown as an error and does not sign the user out', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    backend(student, (url) => (url === `${API_BASE}/auth/password` ? { status: 401, body: { success: false, message: 'The current password is incorrect.' } } : undefined));
    renderWith(<AccountPage />);
    const section = await screen.findByRole('region', { name: 'Change password' });
    fireEvent.change(within(section).getByLabelText('Current password'), { target: { value: 'wrong-password-1' } });
    fireEvent.change(within(section).getByLabelText(/New password/), { target: { value: 'a-much-longer-password' } });
    fireEvent.change(within(section).getByLabelText('Repeat the new password'), { target: { value: 'a-much-longer-password' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Change password' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('The current password is incorrect.');
    expect(localStorage.getItem('carbonroute_token')).toBe('tok');
  });

  it('administrator: lists accounts and creates one; backend validation errors are shown', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const users = [admin, student];
    let createCalls = 0;
    backend(admin, (url, init) => {
      if (url === `${API_BASE}/admin/users` && init?.method === 'POST') {
        createCalls++;
        const body = JSON.parse(String(init.body));
        if (body.username === 'dup') return { status: 400, body: { success: false, message: 'A user with that username or email already exists.' } };
        users.push({ id: 'u2', username: body.username, email: body.email, role: body.role });
        return { status: 201, body: { success: true, data: { id: 'u2', username: body.username, email: body.email, role: body.role } } };
      }
      if (url === `${API_BASE}/admin/users`) return { body: { success: true, data: [...users] } };
      return undefined;
    });
    renderWith(<AccountPage />);
    const region = await screen.findByRole('region', { name: 'Accounts' });
    const list = await within(region).findByRole('table', { name: 'Account list' });
    expect(within(list).getAllByRole('row')).toHaveLength(3);

    const form = within(region).getByRole('form', { name: 'Create account' });
    const fill = (u: string) => {
      fireEvent.change(within(form).getByLabelText('Username'), { target: { value: u } });
      fireEvent.change(within(form).getByLabelText('Email'), { target: { value: `${u}@example.org` } });
      fireEvent.change(within(form).getByLabelText(/Password/), { target: { value: 'a-strong-password-1' } });
      fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'evaluator' } });
    };
    fill('dup');
    fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('already exists');

    fill('bob');
    fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(await within(region).findByRole('status')).toHaveTextContent('Account bob created (evaluator)');
    await waitFor(() => expect(within(within(region).getByRole('table', { name: 'Account list' })).getAllByRole('row')).toHaveLength(4));
    expect(createCalls).toBe(2);
  });
});

describe('authentication-aware navigation', () => {
  it('signed out: "Sign in", no Account or Admin links', async () => {
    renderWith(<Navbar />);
    expect(await screen.findAllByText('Sign in')).not.toHaveLength(0);
    expect(screen.queryByTitle('Admin Dashboard')).toBeNull();
  });

  it('a student sees their Account link but not Admin', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    backend(student);
    renderWith(<Navbar />);
    expect(await screen.findByTitle('Account (alice)')).toBeInTheDocument();
    expect(screen.queryByTitle('Admin Dashboard')).toBeNull();
  });

  it('an administrator sees Account and Admin', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    backend(admin);
    renderWith(<Navbar />);
    expect(await screen.findByTitle('Account (root)')).toBeInTheDocument();
    expect(screen.getByTitle('Admin Dashboard')).toBeInTheDocument();
  });
});
