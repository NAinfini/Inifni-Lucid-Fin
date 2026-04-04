import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n.js';
import { toggleCommander } from '../store/slices/commander.js';

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const value = text.toLowerCase();
  let queryIndex = 0;

  for (let textIndex = 0; textIndex < value.length && queryIndex < q.length; textIndex += 1) {
    if (value[textIndex] === q[queryIndex]) {
      queryIndex += 1;
    }
  }

  return queryIndex === q.length;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'nav-canvas',
        label: t('nav.canvas'),
        category: t('command.categories.navigation'),
        action: () => navigate('/'),
      },
      {
        id: 'nav-settings',
        label: t('nav.settings'),
        category: t('command.categories.navigation'),
        action: () => navigate('/settings'),
      },
      {
        id: 'nav-tasks',
        label: t('nav.tasks'),
        category: t('command.categories.navigation'),
        action: () => navigate('/tasks'),
      },
      {
        id: 'nav-audio',
        label: t('nav.audio'),
        category: t('command.categories.navigation'),
        action: () => navigate('/audio'),
      },
      {
        id: 'nav-export',
        label: t('nav.export'),
        category: t('command.categories.navigation'),
        action: () => navigate('/export'),
      },
      {
        id: 'nav-series',
        label: t('nav.series'),
        category: t('command.categories.navigation'),
        action: () => navigate('/series'),
      },
      {
        id: 'edit-undo',
        label: t('action.undo'),
        category: t('command.categories.edit'),
        shortcut: 'Ctrl+Z',
        action: () => dispatch({ type: 'undo/undo' }),
      },
      {
        id: 'edit-redo',
        label: t('action.redo'),
        category: t('command.categories.edit'),
        shortcut: 'Ctrl+Shift+Z',
        action: () => dispatch({ type: 'undo/redo' }),
      },
      {
        id: 'view-commander',
        label: t('command.toggleCommander'),
        category: t('command.categories.view'),
        shortcut: 'Ctrl+J',
        action: () => dispatch(toggleCommander()),
      },
    ],
    [dispatch, navigate],
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    return commands.filter(
      (command) => fuzzyMatch(query, command.label) || fuzzyMatch(query, command.category),
    );
  }, [commands, query]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
        setQuery('');
        setSelectedIndex(0);
      }

      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const execute = useCallback((item: CommandItem) => {
    item.action();
    setOpen(false);
    setQuery('');
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter' && filtered[selectedIndex]) {
        event.preventDefault();
        execute(filtered[selectedIndex]);
      }
    },
    [execute, filtered, selectedIndex],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t('command.dialogLabel')}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('command.placeholder')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label={t('command.searchLabel')}
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('command.noMatch')}</li>
          ) : null}

          {filtered.map((item, index) => (
            <li
              key={item.id}
              role="option"
              aria-selected={index === selectedIndex}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${
                index === selectedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted'
              }`}
              onClick={() => execute(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span>
                <span className="mr-2 text-xs text-muted-foreground">{item.category}</span>
                {item.label}
              </span>
              {item.shortcut ? (
                <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {item.shortcut}
                </kbd>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
