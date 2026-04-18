/**
 * Folder — a hierarchical grouping container for entities.
 *
 * Each entity kind (character/equipment/location/asset) has its own folders
 * table in storage (`character_folders`, `equipment_folders`, etc.). The `kind`
 * field on `Folder` is redundant with the storage table but useful in-memory
 * when folders of multiple kinds live in the same Redux store.
 *
 * `parentId === null` means root. Unlimited nesting depth; cycle prevention
 * enforced at the storage layer.
 *
 * Entities reference a folder via optional `folderId`; `null` / `undefined`
 * = virtual "Uncategorized" root.
 */

export type FolderKind = 'character' | 'equipment' | 'location' | 'asset';

export interface Folder {
  id: string;
  kind: FolderKind;
  parentId: string | null;
  name: string;
  /** Sort order within the same parent. Lower first; ties broken by name. */
  order: number;
  createdAt: number;
  updatedAt: number;
}
