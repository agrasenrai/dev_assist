// Compatibility entrypoint: always use the isolated database test runner.
process.argv[2] = 'chaos';
await import('./run-tests.js');
export {};
