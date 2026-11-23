import { stopDevProcesses, waitForFirstDevProcessExit } from './devProcessPolicy';
import {
  findAvailablePort,
  isPortAvailable,
  waitForPortRelease,
  waitForRendererReady,
} from './devPortFinder';
import { STUDIO_RESTART_EXIT_CODE } from '../packages/shared/src/repositoryUpdates';

const defaultBackendPort = Number(process.env.STUDIO_SERVER_PORT) || 17223;
const defaultUiPort = Number(process.env.STUDIO_UI_PORT) || 17222;

if (!(await isPortAvailable(defaultUiPort)) || !(await isPortAvailable(defaultUiPort, '0.0.0.0'))) {
  throw new Error(
    `Studio UI port ${defaultUiPort} is already in use. Close that server or choose another STUDIO_UI_PORT.`,
  );
}

const availableBackendPort = await findAvailablePort(defaultBackendPort, 50, '127.0.0.1', [
  defaultUiPort,
]);
const backendBaseUrl = `http://127.0.0.1:${availableBackendPort}`;

if (availableBackendPort !== defaultBackendPort) {
  console.log(
    `[dev] Port ${defaultBackendPort} unavailable for the backend; starting on port ${availableBackendPort}`,
  );
}

let processes: ReturnType<typeof Bun.spawn>[] = [];

// The backend and the UI start together. A slow UI only prints a note: it never stops the backend.
// After an update restart the browser reloads once the UI answers.
function startProcesses() {
  processes = [];
  try {
    const renderer = Bun.spawn(['node', 'scripts/dev-ui.ts'], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
      env: {
        ...process.env,
        STUDIO_UI_PORT: String(defaultUiPort),
        VITE_STUDIO_API_BASE: backendBaseUrl,
      },
    });
    processes.push(renderer);
    void waitForRendererReady(`http://127.0.0.1:${defaultUiPort}/`, renderer).catch(() => {
      // A renderer that exits ends the session through the exit watcher below.
    });
    processes.push(
      Bun.spawn([process.execPath, 'apps/local-server/src/index.ts'], {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
        env: {
          ...process.env,
          STUDIO_SERVER_PORT: String(availableBackendPort),
          STUDIO_MANAGED_RESTART: '1',
        },
      }),
    );
  } catch (error) {
    shutdown();
    throw error;
  }
}

const stopOptions = {
  platform: process.platform,
  killProcessTree:
    process.platform === 'win32'
      ? (pid: number) =>
          Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], {
            stdout: 'ignore',
            stderr: 'ignore',
          }).exitCode === 0
      : undefined,
};

function shutdown() {
  stopDevProcesses(processes, stopOptions);
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

startProcesses();

while (true) {
  const firstExitCode = await waitForFirstDevProcessExit(processes, stopOptions);
  if (firstExitCode !== STUDIO_RESTART_EXIT_CODE) {
    process.exitCode = firstExitCode;
    break;
  }
  console.log('[dev] Restarting Studio...');
  await waitForPortRelease([defaultUiPort, availableBackendPort]);
  startProcesses();
}
