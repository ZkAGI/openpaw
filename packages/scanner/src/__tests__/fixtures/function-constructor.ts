// Test fixture for Function constructor detection
export function createFunction() {
  return new Function('a', 'b', 'return a + b');
}
