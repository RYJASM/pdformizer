import { useEffect, useMemo } from 'react';
import { Database, FileStack, Home as HomeIcon, ListChecks, Moon, Sun, SunMoon } from 'lucide-react';
import { useStore } from './lib/store';
import { navigate, parseHash, routes, useHash, type Route } from './lib/router';
import { ConfirmHost, PromptHost, ToastHost, cx } from './components/ui';
import { Logo } from './components/Logo';
import { Home } from './features/home/Home';
import { Wizard } from './features/wizard/Wizard';
import { FillView } from './features/fill/FillView';
import { Mapper } from './features/mapper/Mapper';
import { FormBuilder } from './features/builder/FormBuilder';
import { DataManager } from './features/data/DataManager';

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function TopBar({ route }: { route: Route }) {
  const settings = useStore((s) => s.settings);
  const sets = useStore((s) => s.sets);
  const forms = useStore((s) => s.forms);
  const saving = useStore((s) => s.saving);
  const storageError = useStore((s) => s.storageError);
  const setSettings = useStore((s) => s.setSettings);
  const activeSet = sets.find((s) => s.id === settings.activeSetId) ?? sets.find((s) => s.formId === settings.activeFormId) ?? sets[0];
  const activeForm = forms.find((f) => f.id === (activeSet?.formId ?? settings.activeFormId)) ?? forms[0];

  const nav: { key: Route['name']; label: string; icon: React.ReactNode; to?: string }[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon />, to: routes.home() },
    { key: 'fill', label: 'Fill', icon: <FileStack />, to: activeSet ? routes.fill(activeSet.id) : undefined },
    { key: 'form', label: 'Form', icon: <ListChecks />, to: activeForm ? routes.form(activeForm.id) : undefined },
    { key: 'data', label: 'Data', icon: <Database />, to: routes.data() },
  ];
  const nextTheme = settings.theme === 'system' ? 'light' : settings.theme === 'light' ? 'dark' : 'system';
  const current = route.name === 'map' ? 'fill' : route.name;

  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate(routes.home())}>
        <Logo size={28} />
        <span>Autofill My PDF</span>
      </button>
      {forms.length > 0 && route.name !== 'wizard' && (
        <nav className="topnav">
          {nav.map((n) => (
            <button key={n.key} className={cx('topnav-item', current === n.key && 'active')} disabled={!n.to} onClick={() => n.to && navigate(n.to)}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
      )}
      <div className="spacer" />
      {storageError ? (
        <span className="save-state error" data-tip={storageError}>
          Not saving — browser storage unavailable
        </span>
      ) : (
        <span className={cx('save-state', saving && 'on')}>{saving ? 'Saving…' : 'Saved'}</span>
      )}
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => setSettings({ theme: nextTheme })}
        data-tip={`Theme: ${settings.theme}`}
        aria-label="Toggle theme"
      >
        {settings.theme === 'dark' ? <Moon /> : settings.theme === 'light' ? <Sun /> : <SunMoon />}
      </button>
    </header>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const hash = useHash();
  const route = useMemo(() => parseHash(hash), [hash]);
  useTheme();
  useEffect(() => {
    void useStore.getState().init();
  }, []);

  if (!ready) {
    return (
      <div className="splash">
        <Logo size={44} />
      </div>
    );
  }

  let view: React.ReactNode;
  switch (route.name) {
    case 'wizard': view = <Wizard />; break;
    case 'fill': view = <FillView key={route.setId} setId={route.setId} />; break;
    case 'map': view = <Mapper key={route.docId} docId={route.docId} setId={route.setId} />; break;
    case 'form': view = <FormBuilder key={route.formId} formId={route.formId} />; break;
    case 'data': view = <DataManager />; break;
    default: view = <Home />;
  }

  return (
    <div className="app">
      <TopBar route={route} />
      <main className="main">{view}</main>
      <ToastHost />
      <ConfirmHost />
      <PromptHost />
    </div>
  );
}
