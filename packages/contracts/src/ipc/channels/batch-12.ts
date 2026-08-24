export interface CharacterSetFolderRequest {
  ids: string[];
  folderId: string | null;
}
export interface CharacterSetFolderResponse {
  movedIds: string[];
}

export type EquipmentSetFolderRequest = CharacterSetFolderRequest;
export type EquipmentSetFolderResponse = CharacterSetFolderResponse;
export type LocationSetFolderRequest = CharacterSetFolderRequest;
export type LocationSetFolderResponse = CharacterSetFolderResponse;
