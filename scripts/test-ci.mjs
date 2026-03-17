import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = ['test', 'run build', 'run smoke'];

for (const step of steps) {
  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, step.split(' '), {
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Step failed: npm ${step} (exit ${code ?? 'unknown'})`));
    });

    child.on('error', reject);
  });
}

console.log('CI verification completed successfully.');
