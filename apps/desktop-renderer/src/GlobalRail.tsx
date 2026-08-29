import React from 'react';
import { Film, FolderOpen } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';

export type GlobalRailDestination = 'projects' | 'media';

interface GlobalRailProps {
  readonly active: GlobalRailDestination;
}

export function GlobalRail({ active }: GlobalRailProps) {
  const { locale } = useDesktopEnvironment();

  return (
    <nav
      className="lucid-global-rail"
      aria-label={locale === 'zh-CN' ? '全局导航' : 'Global navigation'}
    >
      <NavLink
        className={`lucid-rail-button${active === 'projects' ? ' is-active' : ''}`}
        to="/projects"
        aria-label={appCopy(locale, 'projects')}
        aria-current={active === 'projects' ? 'page' : undefined}
        title={appCopy(locale, 'projects')}
      >
        <FolderOpen size={19} />
      </NavLink>
      <NavLink
        className={`lucid-rail-button${active === 'media' ? ' is-active' : ''}`}
        to="/media"
        aria-label={appCopy(locale, 'globalMedia')}
        aria-current={active === 'media' ? 'page' : undefined}
        title={appCopy(locale, 'globalMedia')}
      >
        <Film size={19} />
      </NavLink>
    </nav>
  );
}
