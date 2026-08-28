import type { DomainObjectRef, SelectedContextRef } from '@lucid-fin/contracts';

export const WORKSPACES = ['overview', 'canvas', 'media', 'production', 'delivery'] as const;

export type Workspace = (typeof WORKSPACES)[number];

export function isWorkspace(value: string | null | undefined): value is Workspace {
  return (
    value !== null && value !== undefined && WORKSPACES.some((workspace) => workspace === value)
  );
}

export interface SharedSelection {
  readonly primary: DomainObjectRef | null;
  readonly supporting: readonly DomainObjectRef[];
}

export type SelectionAction =
  | { readonly type: 'select'; readonly ref: DomainObjectRef }
  | { readonly type: 'support'; readonly ref: DomainObjectRef }
  | { readonly type: 'refresh'; readonly ref: DomainObjectRef }
  | {
      readonly type: 'remove';
      readonly authority: DomainObjectRef['authority'];
      readonly id: string;
    }
  | { readonly type: 'clear' };

export const EMPTY_SELECTION: SharedSelection = Object.freeze({
  primary: null,
  supporting: Object.freeze([]),
});

function isSameRef(left: DomainObjectRef, right: DomainObjectRef): boolean {
  return left.authority === right.authority && left.id === right.id;
}

export function selectionReducer(state: SharedSelection, action: SelectionAction): SharedSelection {
  if (action.type === 'clear') return EMPTY_SELECTION;
  if (action.type === 'remove') {
    const matches = (ref: DomainObjectRef) =>
      ref.authority === action.authority && ref.id === action.id;
    return {
      primary: state.primary !== null && matches(state.primary) ? null : state.primary,
      supporting: state.supporting.filter((ref) => !matches(ref)),
    };
  }
  if (action.type === 'refresh') {
    const refresh = (ref: DomainObjectRef) => (isSameRef(ref, action.ref) ? action.ref : ref);
    return {
      primary: state.primary === null ? null : refresh(state.primary),
      supporting: state.supporting.map(refresh),
    };
  }
  if (action.type === 'select') {
    return {
      primary: action.ref,
      supporting: state.supporting.filter((ref) => !isSameRef(ref, action.ref)),
    };
  }
  if (state.primary !== null && isSameRef(state.primary, action.ref)) return state;
  const exists = state.supporting.some((ref) => isSameRef(ref, action.ref));
  return {
    primary: state.primary,
    supporting: exists
      ? state.supporting.filter((ref) => !isSameRef(ref, action.ref))
      : [...state.supporting, action.ref],
  };
}

export function selectionToRunContext(selection: SharedSelection): readonly SelectedContextRef[] {
  return [
    ...(selection.primary === null ? [] : [{ ref: selection.primary, role: 'selected' as const }]),
    ...selection.supporting.map((ref) => ({ ref, role: 'reference' as const })),
  ];
}
