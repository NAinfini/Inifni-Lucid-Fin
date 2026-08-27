import React from 'react';
import { Film, FolderOpen, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { targetCopy } from './copy.js';
import { useTargetEnvironment } from './environment.js';

export type GlobalRailDestination = 'projects' | 'media';

function gateBReason(locale: ReturnType<typeof useTargetEnvironment>['locale']): string {
  return locale === 'zh-CN'
    ? '应用捕获的提供商、设置、语言和主题偏好属于 Gate B 工作。'
    : 'Applying captured provider/settings/locale/theme preferences is Gate B work.';
}

export function GlobalRail({ active }: { readonly active: GlobalRailDestination }) {
  const { locale } = useTargetEnvironment();
  const settingsReason = gateBReason(locale);

  return (
    <nav
      className="target-global-rail"
      aria-label={locale === 'zh-CN' ? '全局导航' : 'Global navigation'}
    >
      <NavLink
        className={`target-rail-button${active === 'projects' ? ' is-active' : ''}`}
        to="/projects"
        aria-label={targetCopy(locale, 'projects')}
        aria-current={active === 'projects' ? 'page' : undefined}
        title={targetCopy(locale, 'projects')}
      >
        <FolderOpen size={19} />
      </NavLink>
      <NavLink
        className={`target-rail-button${active === 'media' ? ' is-active' : ''}`}
        to="/media"
        aria-label={targetCopy(locale, 'globalMedia')}
        aria-current={active === 'media' ? 'page' : undefined}
        title={targetCopy(locale, 'globalMedia')}
      >
        <Film size={19} />
      </NavLink>
      <span className="target-rail-spacer" />
      <button
        className="target-rail-button"
        type="button"
        aria-label={targetCopy(locale, 'settings')}
        aria-describedby="target-global-settings-gate-b"
        disabled
        title={settingsReason}
      >
        <Settings size={19} />
      </button>
      <span id="target-global-settings-gate-b" className="target-visually-hidden">
        {settingsReason}
      </span>
    </nav>
  );
}
