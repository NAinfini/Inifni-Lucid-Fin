/**
 * Pure type shapes for Batch 2 (character:* + equipment:*).
 *
 * No zod, no runtime. Complex DTO payloads (Character, Equipment,
 * ReferenceImage, EquipmentLoadout) are left as `unknown` — Phase C will
 * promote them to the real DTO types once the DTOs themselves are
 * contract-owned.
 */

import type { Character } from '../../dto/character.js';
import type { Equipment } from '../../dto/equipment.js';

// ── character:list ───────────────────────────────────────────
export type CharacterListRequest = Record<string, never>;
export type CharacterListResponse = unknown[];

// ── character:get ────────────────────────────────────────────
export interface CharacterGetRequest {
  id: string;
}
export type CharacterGetResponse = unknown;

// ── character:save ───────────────────────────────────────────
export type CharacterSaveRequest = unknown;
export type CharacterSaveResponse = unknown;

// ── character:delete ─────────────────────────────────────────
export interface CharacterCopyRequest {
  ids: string[];
  targetFolderId: string | null;
}
export interface CharacterCopyResponse {
  created: Character[];
}

export interface CharacterDeleteRequest {
  ids: string[];
}
export interface CharacterDeleteResponse {
  deletedIds: string[];
}

// ── character:setRefImage ────────────────────────────────────
export interface CharacterSetRefImageRequest {
  characterId: string;
  slot: string;
  assetHash: string;
  isStandard: boolean;
}
export type CharacterSetRefImageResponse = unknown;

// ── character:removeRefImage ─────────────────────────────────
export interface CharacterRemoveRefImageRequest {
  characterId: string;
  slot: string;
}
export type CharacterRemoveRefImageResponse = void;

// ── character:saveLoadout ────────────────────────────────────
export interface CharacterSaveLoadoutRequest {
  characterId: string;
  loadout: unknown;
}
export type CharacterSaveLoadoutResponse = unknown;

// ── character:deleteLoadout ──────────────────────────────────
export interface CharacterDeleteLoadoutRequest {
  characterId: string;
  loadoutId: string;
}
export type CharacterDeleteLoadoutResponse = void;

// ── equipment:list ───────────────────────────────────────────
export interface EquipmentListRequest {
  type?: string;
}
export type EquipmentListResponse = unknown[];

// ── equipment:get ────────────────────────────────────────────
export interface EquipmentGetRequest {
  id: string;
}
export type EquipmentGetResponse = unknown;

// ── equipment:save ───────────────────────────────────────────
export type EquipmentSaveRequest = unknown;
export type EquipmentSaveResponse = unknown;

// ── equipment:delete ─────────────────────────────────────────
export interface EquipmentCopyRequest {
  ids: string[];
  targetFolderId: string | null;
}
export interface EquipmentCopyResponse {
  created: Equipment[];
}

export interface EquipmentDeleteRequest {
  ids: string[];
}
export interface EquipmentDeleteResponse {
  deletedIds: string[];
}

// ── equipment:setRefImage ────────────────────────────────────
export interface EquipmentSetRefImageRequest {
  equipmentId: string;
  slot: string;
  assetHash: string;
  isStandard: boolean;
}
export type EquipmentSetRefImageResponse = unknown;

// ── equipment:removeRefImage ─────────────────────────────────
export interface EquipmentRemoveRefImageRequest {
  equipmentId: string;
  slot: string;
}
export type EquipmentRemoveRefImageResponse = void;
