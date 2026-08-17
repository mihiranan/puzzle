export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureFreshAtlas } = await import("./lib/atlas-refresh");
  void ensureFreshAtlas();
}
