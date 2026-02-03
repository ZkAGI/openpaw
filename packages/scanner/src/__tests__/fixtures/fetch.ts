// Test fixture for fetch detection
export async function makeRequest(url: string) {
  const response = await fetch(url);
  return response.json();
}
