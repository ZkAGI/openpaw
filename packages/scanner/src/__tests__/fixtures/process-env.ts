// Test fixture for process.env access
export function getApiKey() {
  return process.env.API_KEY;
}

export function checkNodeEnv() {
  if (process.env.NODE_ENV === 'production') {
    console.log('prod');
  }
}
