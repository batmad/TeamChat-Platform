export type ChatWidgetRole = {
  id?: string;
  code?: string;
  name?: string;
};

export type ChatWidgetGroup = {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
  source?: string;
  membershipSource?: string;
};

export type ChatWidgetUser = {
  identityId: string;
  username: string;
  name: string;
  role: ChatWidgetRole | null;
  permissions: string[];
  groups: ChatWidgetGroup[];
  primaryGroup: ChatWidgetGroup | null;
};

export type ChatWidgetSession = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  sessionReference: string;
  application: {
    id: string;
    key: string;
    name: string;
  };
  user: ChatWidgetUser;
  expiresAt: number;
};

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  requestId?: string;
};

export class ChatWidgetAuthError extends Error {
  constructor(
    message: string,
    public readonly code = "CHAT_WIDGET_AUTH_ERROR",
    public readonly status = 0,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ChatWidgetAuthError";
  }
}

export type ChatWidgetAuthClientOptions = {
  chatBaseUrl: string;
  applicationKey: string;
  storage?: "memory" | "session";
  fetchImpl?: typeof fetch;
};

type StoredSession = ChatWidgetSession;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export class ChatWidgetAuthClient {
  private readonly chatBaseUrl: string;
  private readonly applicationKey: string;
  private readonly storage: "memory" | "session";
  private readonly fetchImpl: typeof fetch;
  private memorySession: ChatWidgetSession | null = null;

  constructor(options: ChatWidgetAuthClientOptions) {
    this.chatBaseUrl = normalizeBaseUrl(options.chatBaseUrl);
    this.applicationKey = options.applicationKey;
    this.storage = options.storage ?? "session";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get storageKey() {
    return `central-chat:session:${this.applicationKey}`;
  }

  private readStoredSession(): StoredSession | null {
    if (this.memorySession) return this.memorySession;
    if (this.storage !== "session" || !canUseSessionStorage()) return null;

    const raw = window.sessionStorage.getItem(this.storageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed?.accessToken || parsed.application?.key !== this.applicationKey) {
        this.clear();
        return null;
      }
      if (parsed.expiresAt <= Date.now()) {
        this.clear();
        return null;
      }
      this.memorySession = parsed;
      return parsed;
    } catch {
      this.clear();
      return null;
    }
  }

  private saveSession(session: ChatWidgetSession) {
    this.memorySession = session;
    if (this.storage === "session" && canUseSessionStorage()) {
      window.sessionStorage.setItem(this.storageKey, JSON.stringify(session));
    }
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    let body: ApiEnvelope<T> | null = null;
    try {
      body = (await response.json()) as ApiEnvelope<T>;
    } catch {
      // Keep the standardized fallback below.
    }

    if (!response.ok || !body?.success || !body.data) {
      throw new ChatWidgetAuthError(
        body?.error?.message ?? `Chat authentication request failed with HTTP ${response.status}`,
        body?.error?.code ?? "CHAT_WIDGET_AUTH_REQUEST_FAILED",
        response.status,
        body?.requestId ?? response.headers.get("x-request-id") ?? undefined,
        body?.error?.details,
      );
    }

    return body.data;
  }

  async authenticate(bootstrapToken: string): Promise<ChatWidgetSession> {
    const response = await this.fetchImpl(`${this.chatBaseUrl}/api/widget/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: bootstrapToken }),
    });

    const exchanged = await this.parseResponse<Omit<ChatWidgetSession, "expiresAt">>(response);
    if (exchanged.application.key !== this.applicationKey) {
      throw new ChatWidgetAuthError(
        "Authenticated application does not match widget application key",
        "CHAT_WIDGET_APPLICATION_MISMATCH",
        401,
      );
    }

    const session: ChatWidgetSession = {
      ...exchanged,
      expiresAt: Date.now() + exchanged.expiresIn * 1000,
    };
    this.saveSession(session);
    return session;
  }

  async restore(): Promise<ChatWidgetSession | null> {
    const session = this.readStoredSession();
    if (!session) return null;

    try {
      const current = await this.me();
      const refreshed: ChatWidgetSession = {
        ...session,
        application: current.application,
        user: current.user,
        sessionReference: current.sessionReference,
      };
      this.saveSession(refreshed);
      return refreshed;
    } catch (error) {
      if (error instanceof ChatWidgetAuthError && [401, 403].includes(error.status)) {
        this.clear();
        return null;
      }
      throw error;
    }
  }

  async ensureAuthenticated(bootstrapToken?: string | null): Promise<ChatWidgetSession> {
    const restored = await this.restore();
    if (restored) return restored;
    if (!bootstrapToken) {
      throw new ChatWidgetAuthError(
        "A new signed bootstrap token is required",
        "WIDGET_BOOTSTRAP_TOKEN_REQUIRED",
        401,
      );
    }
    return this.authenticate(bootstrapToken);
  }

  async me(): Promise<{
    application: ChatWidgetSession["application"];
    user: ChatWidgetUser;
    sessionReference: string;
  }> {
    const session = this.readStoredSession();
    if (!session) {
      throw new ChatWidgetAuthError("Chat session is not available", "CHAT_SESSION_REQUIRED", 401);
    }

    const response = await this.fetchImpl(`${this.chatBaseUrl}/api/widget/auth/me`, {
      method: "GET",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    return this.parseResponse(response);
  }

  getSession() {
    return this.readStoredSession();
  }

  getAccessToken() {
    return this.readStoredSession()?.accessToken ?? null;
  }

  clear() {
    this.memorySession = null;
    if (this.storage === "session" && canUseSessionStorage()) {
      window.sessionStorage.removeItem(this.storageKey);
    }
  }
}
