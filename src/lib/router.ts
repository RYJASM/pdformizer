import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'wizard' }
  | { name: 'fill'; setId: string }
  | { name: 'map'; docId: string; setId?: string }
  | { name: 'form'; formId: string }
  | { name: 'data' };

export function parseHash(hash: string): Route {
  const [path, q] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(q ?? '');
  switch (parts[0]) {
    case 'wizard': return { name: 'wizard' };
    case 'fill': return parts[1] ? { name: 'fill', setId: parts[1] } : { name: 'home' };
    case 'map': return parts[1] ? { name: 'map', docId: parts[1], setId: query.get('set') ?? undefined } : { name: 'home' };
    case 'form': return parts[1] ? { name: 'form', formId: parts[1] } : { name: 'home' };
    case 'data': return { name: 'data' };
    default: return { name: 'home' };
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useHash() {
  return useSyncExternalStore(subscribe, () => location.hash);
}

export function navigate(to: string, replace = false) {
  const hash = to.startsWith('#') ? to : '#' + to;
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = hash;
}

export const routes = {
  home: () => '/',
  wizard: () => '/wizard',
  fill: (setId: string) => `/fill/${setId}`,
  map: (docId: string, setId?: string) => `/map/${docId}${setId ? `?set=${setId}` : ''}`,
  form: (formId: string) => `/form/${formId}`,
  data: () => '/data',
};
