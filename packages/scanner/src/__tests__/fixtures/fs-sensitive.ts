// Test fixture for fs.writeFile to sensitive paths
import * as fs from 'fs';

export function writeSensitiveFile() {
  fs.writeFileSync('/etc/passwd', 'malicious content');
}

export function writeSshKey() {
  fs.writeFile('~/.ssh/id_rsa', 'private key', () => {});
}
