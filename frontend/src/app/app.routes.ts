import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards';

const STAFF = ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'];
const OPERATORS = ['OPERATIONS_ANALYST', 'ADMIN'];

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', title: 'Home', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
      { path: 'accounts', title: 'Accounts', loadComponent: () => import('./features/accounts/accounts.component').then((m) => m.AccountsComponent) },
      { path: 'accounts/:id', title: 'Account', loadComponent: () => import('./features/accounts/account-detail.component').then((m) => m.AccountDetailComponent) },
      { path: 'transactions', title: 'Transactions', loadComponent: () => import('./features/transactions/transactions.component').then((m) => m.TransactionsComponent) },
      { path: 'transactions/new', title: 'New transaction', loadComponent: () => import('./features/transactions/transaction-new.component').then((m) => m.TransactionNewComponent) },
      { path: 'transactions/:id', title: 'Transaction', loadComponent: () => import('./features/transactions/transaction-detail.component').then((m) => m.TransactionDetailComponent) },
      {
        path: 'customers', title: 'Customers', canActivate: [roleGuard], data: { roles: STAFF },
        loadComponent: () => import('./features/customers/customers.component').then((m) => m.CustomersComponent),
      },
      {
        path: 'investigations', title: 'Investigations', canActivate: [roleGuard], data: { roles: STAFF },
        loadComponent: () => import('./features/investigations/investigations.component').then((m) => m.InvestigationsComponent),
      },
      {
        path: 'audit', title: 'Audit trail', canActivate: [roleGuard], data: { roles: STAFF },
        loadComponent: () => import('./features/audit/audit.component').then((m) => m.AuditComponent),
      },
      { path: 'forbidden', title: 'Not permitted', loadComponent: () => import('./features/shell/not-found.component').then((m) => m.ForbiddenComponent) },
      { path: '**', title: 'Not found', loadComponent: () => import('./features/shell/not-found.component').then((m) => m.NotFoundComponent) },
    ],
  },
];

export const ROLE_GROUPS = { STAFF, OPERATORS };
