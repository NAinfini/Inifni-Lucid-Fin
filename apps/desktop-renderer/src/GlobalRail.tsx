import React from 'react';
import { Film, FolderOpen, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';

export type GlobalRailDestination = 'projects' | 'media';

interface GlobalRailProps {
  readonly active: GlobalRailDestination;
  readonly showSettings?: boolean;
}

function gateBReason(locale: ReturnType<typeof useDesktopEnvironment>['locale']): string {
  return locale === 'zh-CN'
    ? '应用捕获的提供商、设置、语言和主题偏好属于 Gate B 工作。'
    : 'Applying captured provider/settings/locale/theme preferences is Gate B work.';
}

export function GlobalRail({ active, showSettings = true }: GlobalRailProps) {
  const { locale } = useDesktopEnvironment();
  const settingsReason = gateBReason(locale);

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
      <span className="lucid-rail-spacer" />
      {showSettings && (
        <>
          <button
            className="lucid-rail-button"
            type="button"
            aria-label={appCopy(locale, 'settings')}
            aria-describedby="lucid-global-settings-gate-b"
            disabled
            title={settingsReason}
          >
            <Settings size={19} />
          </button>
          <span id="lucid-global-settings-gate-b" className="lucid-visually-hidden">
            {settingsReason}
          </span>
        </>
      )}
    </nav>
  );
}
