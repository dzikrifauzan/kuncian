import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Router mini: cukup untuk beberapa layar, tanpa dependensi tambahan.
const RouterCtx = createContext(null);

export function Router({ children }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));

  useEffect(() => {
    const onPop = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const nav = useCallback((to, opts = {}) => {
    const u = new URL(to, location.origin);
    history[opts.replace ? 'replaceState' : 'pushState'](null, '', u.pathname + u.search);
    setLoc({ path: u.pathname, search: u.search });
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ loc, nav }), [loc, nav]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useNav = () => useContext(RouterCtx).nav;
export const useLoc = () => useContext(RouterCtx).loc;

export function useSearch() {
  const { search } = useLoc();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** matchPath('/pesan/:id', '/pesan/7') -> { id: '7' }, atau null kalau tidak cocok. */
export function matchPath(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export function Link({ to, children, replace, onClick, ...rest }) {
  const nav = useNav();
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        nav(to, { replace });
      }}
    >
      {children}
    </a>
  );
}
