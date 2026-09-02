export function attachmentContentDisposition(
  mode: "inline" | "attachment",
  originalName: string,
) {
  const fallback = originalName
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/[\r\n"]/g, "_")
    .slice(0, 180) || "attachment";
  const encoded = encodeURIComponent(originalName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
