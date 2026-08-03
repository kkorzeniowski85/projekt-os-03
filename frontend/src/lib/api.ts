export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";

/**
 * Access token zyje wylacznie w pamieci modulu - nigdy w localStorage.
 * Dzieki temu XSS nie moze go wykrasc z trwalego magazynu. Trwalosc sesji
 * daje refresh token w ciasteczku httpOnly, ktorego JS w ogole nie widzi.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    // Bledy walidacji Pydantica przychodza jako lista obiektow.
    if (Array.isArray(body?.detail)) {
      return body.detail.map((d: { msg?: string }) => d.msg ?? "").join("; ");
    }
  } catch {
    /* odpowiedz bez JSON-a */
  }
  return `Blad ${response.status}`;
}

/** Odswiezanie tokenu single-flight: rownolegle 401 czekaja na jedno zapytanie. */
let refreshInFlight: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!response.ok) {
          setAccessToken(null);
          return false;
        }
        const data = (await response.json()) as { access_token: string };
        setAccessToken(data.access_token);
        return true;
      } catch {
        setAccessToken(null);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown; auth?: boolean };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;

  // FormData (wysylka pliku) musi pojsc surowo - przegladarka sama ustawi
  // Content-Type razem z granica multipart, ktorej my nie znamy.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: "include",
      headers: {
        ...(body !== undefined && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body:
        body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });

  let response = await send();

  // Access token zyje 15 minut - jedna cicha proba odswiezenia zamiast
  // wyrzucania uzytkownika z ekranu nauki.
  if (response.status === 401 && auth && (await refreshSession())) {
    response = await send();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
