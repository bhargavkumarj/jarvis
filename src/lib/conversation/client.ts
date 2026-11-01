export async function contentRequest<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request not confirmed. Reload to check before retrying.");
  return data as T;
}
