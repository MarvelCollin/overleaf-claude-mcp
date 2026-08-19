export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
}

export interface StoredSession {
  savedAt: string;
  baseUrl: string;
  cookies: StoredCookie[];
}

export interface InstalledBrowser {
  name: string;
  executable: string;
  userDataDir: string;
}
