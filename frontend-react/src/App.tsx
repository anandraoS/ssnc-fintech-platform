import { lazy, ReactElement, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from './core/auth';
import { Role } from './core/models';
import { Forbidden, NotFound } from './features/NotFound';
import { Login } from './features/Login';
import { Shell } from './features/Shell';

// routes are code-split so the sign-in page and shell stay small
const Home = lazy(() => import('./features/Home').then((m) => ({ default: m.Home })));
const Accounts = lazy(() => import('./features/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./features/Accounts').then((m) => ({ default: m.AccountDetail })));
const Transactions = lazy(() => import('./features/Transactions').then((m) => ({ default: m.Transactions })));
const TransactionNew = lazy(() => import('./features/TransactionNew').then((m) => ({ default: m.TransactionNew })));
const TransactionDetail = lazy(() => import('./features/TransactionDetail').then((m) => ({ default: m.TransactionDetail })));
const Customers = lazy(() => import('./features/Customers').then((m) => ({ default: m.Customers })));
const Investigations = lazy(() => import('./features/Investigations').then((m) => ({ default: m.Investigations })));
const Audit = lazy(() => import('./features/Audit').then((m) => ({ default: m.Audit })));

export const STAFF: Role[] = ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'];

const staffOnly = (element: ReactElement) => <RequireRole roles={STAFF}>{element}</RequireRole>;

export function App() {
  return (
    <Suspense fallback={<div className="state-box" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span>Loading…</span></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="transactions/new" element={<TransactionNew />} />
          <Route path="transactions/:id" element={<TransactionDetail />} />
          <Route path="customers" element={staffOnly(<Customers />)} />
          <Route path="investigations" element={staffOnly(<Investigations />)} />
          <Route path="audit" element={staffOnly(<Audit />)} />
          <Route path="forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
