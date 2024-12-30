import { defineConfig } from 'rolldown'

export default defineConfig({
    input: 'src/robin.ts',
    output: {
        file: 'dist/robin.mjs',
        inlineDynamicImports: true
    }
})