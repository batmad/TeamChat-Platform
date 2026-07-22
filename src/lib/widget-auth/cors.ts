export function applyWidgetCors(response: Response, origin: string | null): Response {
  if (origin) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("vary", "Origin");
  }
  return response;
}

export function widgetPreflightResponse(request: Request, methods: string): Response {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "Content-Type, Authorization, X-Request-ID",
    "access-control-max-age": "600",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}
