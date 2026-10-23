import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../core/auth';
import { Role } from '../core/models';

interface NavItem {
  label: string;
  path: string;
  roles?: Role[];
  exact?: boolean;
}

export const NAV: NavItem[] = [
  { label: 'Overview', path: '/', exact: true },
  { label: 'Accounts', path: '/accounts' },
  { label: 'Transactions', path: '/transactions', exact: true },
  { label: 'New transaction', path: '/transactions/new', roles: ['CUSTOMER', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Customers', path: '/customers', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Investigations', path: '/investigations', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
  { label: 'Audit trail', path: '/audit', roles: ['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'ADMIN'] },
];

const COMPACT_QUERY = '(max-width: 899px)';

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

/** Application frame: role-aware navigation, responsive sidenav (collapses to an overlay on small screens). */
export function Shell() {
  const auth = useAuth();
  const compact = useCompact();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV.filter((i) => !i.roles || auth.hasAny(...i.roles));
  const roleLabel = auth.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ');
  const showNav = !compact || drawerOpen;

  // close the overlay after navigating
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="bar">
        <button type="button" className="menu" aria-label="Toggle navigation" aria-expanded={showNav} onClick={() => setDrawerOpen((o) => !o)}>
          <span aria-hidden="true">&#9776;</span>
        </button>
        <span className="title">Investment Operations Console</span>
        <span className="demo" title="All data is synthetic">synthetic demo</span>
        <span className="spacer" />
        {auth.user && <span className="who">{auth.user.username} · {roleLabel}</span>}
        <button type="button" className="btn text" onClick={() => auth.logout()}>Sign out</button>
      </header>
      <div className="frame">
        {showNav && (
          <nav className={`sidenav${compact ? ' over' : ''}`} aria-label="Main">
            {items.map((item) => (
              <NavLink key={item.path} to={item.path} end={!!item.exact} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="content">
          <main id="main" tabIndex={-1}><Outlet /></main>
        </div>
      </div>
    </div>
  );
}
