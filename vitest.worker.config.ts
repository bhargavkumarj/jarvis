import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/worker/**/*.test.ts'],environment:'node',fileParallelism:false,testTimeout:120_000,hookTimeout:30_000}});
