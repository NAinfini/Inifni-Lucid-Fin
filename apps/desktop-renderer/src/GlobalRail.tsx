import React from 'react';
import { FolderOpen, LibraryBig, Settings2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';

export type GlobalRailDestination = 'projects' | 'assets' | 'settings';

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
        <span>{appCopy(locale, 'projects')}</span>
      </NavLink>
      <NavLink
        className={`lucid-rail-button${active === 'assets' ? ' is-active' : ''}`}
        to="/assets"
        aria-label={locale === 'zh-CN' ? '资产' : 'Assets'}
        aria-current={active === 'assets' ? 'page' : undefined}
        title={locale === 'zh-CN' ? '资产' : 'Assets'}
      >
        <LibraryBig size={19} />
        <span>{locale === 'zh-CN' ? '资产' : 'Assets'}</span>
      </NavLink>
      <NavLink
        className={`lucid-rail-button${active === 'settings' ? ' is-active' : ''}`}
        to="/settings"
        aria-label={locale === 'zh-CN' ? '设置' : 'Settings'}
        aria-current={active === 'settings' ? 'page' : undefined}
        title={locale === 'zh-CN' ? '设置' : 'Settings'}
      >
        <Settings2 size={19} />
        <span>{locale === 'zh-CN' ? '设置' : 'Settings'}</span>
      </NavLink>
    </nav>
  );
}
