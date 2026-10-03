/**
 * Yayra Floating Browser - Password Manager (TypeScript Definitions)
 */

export interface SavedCredential {
  id: string;
  origin: string;
  username: string;
  password?: string;
  title?: string;
  createdAt?: number;
  lastUsedAt?: number;
}

export interface PasswordManagerConfig {
  savePasswordsEnabled: boolean;
  autofillEnabled: boolean;
}

export declare class PasswordManager {
  constructor(adapter: any);
  getConfig(): Promise<PasswordManagerConfig>;
  updateConfig(updates: Partial<PasswordManagerConfig>): Promise<PasswordManagerConfig>;
  getAllCredentials(): Promise<SavedCredential[]>;
  getCredentialsForOrigin(origin: string): Promise<SavedCredential[]>;
  saveCredential(params: {
    origin: string;
    username: string;
    password: string;
    title?: string;
    isPrivate?: boolean;
  }): Promise<{ success: boolean; reason?: string }>;
  updateCredential(id: string, updates: Partial<SavedCredential>): Promise<boolean>;
  deleteCredential(id: string): Promise<boolean>;
  clearAllCredentials(): Promise<boolean>;
  normalizeOrigin(urlOrOrigin: string): string;
}
