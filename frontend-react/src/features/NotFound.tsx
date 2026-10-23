import { Link } from 'react-router-dom';
import { useTitle } from '../core/useAsync';

export function NotFound() {
  useTitle('Not found');
  return (
    <section className="page">
      <h1>Page not found</h1>
      <p className="subtitle">The page you asked for does not exist.</p>
      <Link className="btn stroked" to="/">Back to overview</Link>
    </section>
  );
}

export function Forbidden() {
  useTitle('Not permitted');
  return (
    <section className="page">
      <h1>Not permitted</h1>
      <p className="subtitle" role="alert">Your role does not allow access to this page.</p>
      <Link className="btn stroked" to="/">Back to overview</Link>
    </section>
  );
}
